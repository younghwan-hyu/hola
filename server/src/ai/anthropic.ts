import { randomUUID } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";

import type { AiConfig } from "../config.ts";
import { MAX_TOOL_STEPS, callTool, type Tool } from "../tools/index.ts";
import type { AiInput, AiProvider, AiSession } from "./types.ts";

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

/** Placeholder swapped in for an evicted (stale) camera image in history. */
const IMG_PLACEHOLDER = "[이전 카메라 캡처 — 생략됨]";

/**
 * Return a copy of `history` keeping at most the single most recent camera image
 * (0 if this turn already carries a fresh image); older image blocks become a
 * text block so re-sending the full history doesn't resend stale base64 frames.
 * Works on a shallow copy (cloning only the user messages it edits) so the live
 * session history is never mutated — a turn that throws before it commits must
 * leave the previously retained image intact. (tool_result user messages carry
 * no image blocks, so they're untouched.)
 */
function pruneAnthropicImages(
  history: Anthropic.MessageParam[],
  currentTurnHasImage: boolean,
): Anthropic.MessageParam[] {
  const copy = history.map((msg) =>
    msg.role === "user" && Array.isArray(msg.content)
      ? { ...msg, content: [...msg.content] }
      : msg,
  );
  let budget = currentTurnHasImage ? 0 : 1;
  for (let i = copy.length - 1; i >= 0; i--) {
    const msg = copy[i];
    if (!msg || msg.role !== "user" || !Array.isArray(msg.content)) continue;
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j];
      if (!block || block.type !== "image") continue;
      if (budget > 0) budget--;
      else msg.content[j] = { type: "text", text: IMG_PLACEHOLDER };
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
    async *stream(
      { prompt, image }: AiInput,
      session: AiSession,
    ): AsyncIterable<string> {
      // `session` is always one this provider issued via createSession().
      const s = session as AnthropicSession;
      // Evict stale images from a COPY of history (committed only on success).
      const history = pruneAnthropicImages(s.history, image !== undefined);
      // Anthropic recommends placing the image before the text.
      const userMessage: Anthropic.MessageParam = image
        ? {
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
          }
        : { role: "user", content: prompt };
      const messages: Anthropic.MessageParam[] = [...history, userMessage];

      // Agentic loop: stream text, and whenever the model stops on tool_use,
      // run the tools, append the results, and continue until it answers.
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const stream = client.messages.stream({
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
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const delta = event.delta.text;
            if (delta.length > 0) yield delta;
          }
        }

        const final = await stream.finalMessage();
        if (final.stop_reason !== "tool_use") {
          // Final answer: record the assistant turn so the session remembers it.
          messages.push({ role: "assistant", content: final.content });
          break;
        }

        // Echo the assistant turn back verbatim (preserves any thinking blocks),
        // then answer every tool_use block with a tool_result.
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

      // Persist the full conversation so the next call continues it. (System is
      // a top-level param on Anthropic, so it never lives in `messages`.)
      s.history = messages;
    },
  };
}
