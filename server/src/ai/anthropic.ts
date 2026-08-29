import { randomUUID } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";

import type { AiConfig } from "../config.ts";
import { MAX_TOOL_STEPS, callTool, type Tool } from "../tools/index.ts";
import {
  CAMERA_IMAGE_LABEL,
  DOCUMENT_IMAGE_LABEL,
  type AiClassifyInput,
  type AiInput,
  type AiProvider,
  type AiSession,
} from "./types.ts";

interface AnthropicSession extends AiSession {
  key: string;
  history: Anthropic.MessageParam[];
}

/** Image MIME types accepted as an Anthropic base64 image source. */
type AnthropicImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

/** Placeholder swapped in for an evicted (stale) capture image in history. */
const IMG_PLACEHOLDER = "[이전 캡처 — 생략됨]";

/**
 * Request options for `classify`: the browser polls it and gives up after ~8s,
 * so a slow call is just a missed tick — don't let the SDK's default (minutes
 * of timeout plus retries) keep working on a verdict nobody will read.
 */
const CLASSIFY_REQUEST_OPTIONS = { timeout: 15_000, maxRetries: 0 } as const;

/** base64 image block for a captured frame (camera or doc-viewer page). */
function toImageBlock(img: {
  bytes: Buffer;
  mimeType: string;
}): Anthropic.ImageBlockParam {
  return {
    type: "image",
    source: {
      type: "base64",
      // Safe: the route validated mimetype against this same set.
      media_type: img.mimeType as AnthropicImageMediaType,
      data: img.bytes.toString("base64"),
    },
  };
}

/**
 * Return a copy of `history` where stale capture images become a text block, so
 * re-sending the full history doesn't resend stale base64 frames. The most
 * recent image-bearing user message keeps its images (a doc capture and a
 * camera frame sent together form one snapshot of that moment) — unless the
 * current turn carries fresh images, in which case no history image survives.
 * Works on a shallow copy (cloning only the user messages it edits) so the live
 * session history is never mutated — a turn that throws before it commits must
 * leave the previously retained images intact. (tool_result user messages carry
 * no image blocks, so they're untouched.)
 */
function pruneAnthropicImages(
  history: Anthropic.MessageParam[],
  currentTurnHasImages: boolean,
): Anthropic.MessageParam[] {
  const copy = history.map((msg) =>
    msg.role === "user" && Array.isArray(msg.content)
      ? { ...msg, content: [...msg.content] }
      : msg,
  );
  let keepNewest = !currentTurnHasImages;
  for (let i = copy.length - 1; i >= 0; i--) {
    const msg = copy[i];
    if (!msg || msg.role !== "user" || !Array.isArray(msg.content)) continue;
    if (!msg.content.some((b) => b?.type === "image")) continue;
    if (keepNewest) {
      keepNewest = false;
      continue;
    }
    for (let j = 0; j < msg.content.length; j++) {
      const block = msg.content[j];
      if (block?.type === "image")
        msg.content[j] = { type: "text", text: IMG_PLACEHOLDER };
    }
  }
  return copy;
}

export function createAnthropicProvider(
  apiKey: string,
  cfg: AiConfig,
  tools: Tool[] = [],
): AiProvider {
  const client = new Anthropic({ apiKey });
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolDefs: Anthropic.Tool[] | undefined =
    tools.length > 0
      ? tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        }))
      : undefined;

  return {
    name: "anthropic",
    createSession(): AnthropicSession {
      return { key: randomUUID(), history: [] };
    },
    async warmup(): Promise<void> {
      // SDK 0.32.x has no models.list / countTokens — cheapest warm path is a
      // 1-token messages.create (~$0.0001 per startup).
      await client.messages.create({
        model: cfg.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      });
    },
    async classify({
      prompt,
      image,
      maxTokens,
    }: AiClassifyInput): Promise<string> {
      // No system prompt, no history, no tools and — importantly — no extended
      // thinking: this is a polled label lookup, and a thinking budget would
      // both blow past `maxTokens` and cost far more than the answer is worth.
      const res = await client.messages.create({
        model: cfg.model,
        max_tokens: maxTokens,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  // Safe: the route validated mimetype against this same set.
                  media_type: image.mimeType as AnthropicImageMediaType,
                  data: image.bytes.toString("base64"),
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }, CLASSIFY_REQUEST_OPTIONS);
      return res.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();
    },
    async *stream(
      { prompt, image, document }: AiInput,
      session: AiSession,
      signal?: AbortSignal,
    ): AsyncIterable<string> {
      // `session` is always one this provider issued via createSession().
      const s = session as AnthropicSession;
      // Identity of the history this turn started from, so an interrupted turn
      // can tell whether a later turn already committed over it (see below).
      const historyAtStart = s.history;
      // Evict stale images from a COPY of history (committed only on success).
      const history = pruneAnthropicImages(
        s.history,
        image !== undefined || document !== undefined,
      );
      // Anthropic recommends placing images before the text. Each attached
      // image is preceded by its label text block so the model can tell the
      // doc-viewer capture from the camera frame (see ./types.ts).
      const blocks: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> =
        [];
      if (document) {
        blocks.push(
          { type: "text", text: DOCUMENT_IMAGE_LABEL },
          toImageBlock(document),
        );
      }
      if (image) {
        blocks.push(
          { type: "text", text: CAMERA_IMAGE_LABEL },
          toImageBlock(image),
        );
      }
      blocks.push({ type: "text", text: prompt });
      const userMessage: Anthropic.MessageParam =
        blocks.length > 1
          ? { role: "user", content: blocks }
          : { role: "user", content: prompt };
      const messages: Anthropic.MessageParam[] = [...history, userMessage];

      // Everything the model said this turn, across tool steps. Tracked outside
      // the loop so an interrupted turn can still be committed (see finally).
      let spoken = "";
      let committed = false;
      try {
        // Agentic loop: stream text, and whenever the model stops on tool_use,
        // run the tools, append the results, and continue until it answers.
        for (let step = 0; step < MAX_TOOL_STEPS; step++) {
          const stream = client.messages.stream(
            {
              model: cfg.model,
              max_tokens: 8192,
              system: cfg.systemPrompt,
              messages,
              ...(toolDefs ? { tools: toolDefs } : {}),
              ...(cfg.anthropicThinkingBudget
                ? {
                    thinking: {
                      type: "enabled",
                      budget_tokens: cfg.anthropicThinkingBudget,
                    },
                  }
                : {}),
            },
            { signal },
          );

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const delta = event.delta.text;
              if (delta.length > 0) {
                spoken += delta;
                yield delta;
              }
            }
          }

          const final = await stream.finalMessage();
          if (final.stop_reason !== "tool_use") {
            // Final answer: record the assistant turn so the session remembers it.
            messages.push({ role: "assistant", content: final.content });
            break;
          }

          // Echo the assistant turn back verbatim (preserves any thinking
          // blocks), then answer every tool_use block with a tool_result.
          messages.push({ role: "assistant", content: final.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type !== "tool_use") continue;
            const result = await callTool(toolMap, block.name, block.input);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result,
            });
          }
          messages.push({ role: "user", content: toolResults });
        }

        // Persist the full conversation so the next call continues it. (System
        // is a top-level param on Anthropic, so it never lives in `messages`.)
        //
        // Interrupted before the model said anything: not a turn at all, and
        // committing it would leave two user messages in a row, which the API
        // rejects on the next call.
        const interruptedSilently = (signal?.aborted ?? false) && !spoken;
        if (!interruptedSilently) {
          s.history = messages;
          committed = true;
        }
      } finally {
        // Interrupted (client hung up) or failed mid-stream. Commit "user asked
        // X, avatar said Y" so the next turn isn't missing an exchange the user
        // actually heard. The unfinished step's tool plumbing is dropped: it
        // only mattered to the answer that never arrived, and leaving it out
        // keeps the roles alternating. Nothing said -> commit nothing, or
        // history would end on a user message with no reply.
        const partial = spoken.trimEnd();
        if (!committed && partial.length > 0 && s.history === historyAtStart) {
          s.history = [
            ...history,
            userMessage,
            { role: "assistant", content: partial },
          ];
        }
      }
    },
  };
}
