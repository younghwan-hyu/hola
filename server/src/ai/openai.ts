import { randomUUID } from "node:crypto";

import OpenAI from "openai";

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

interface OpenAiSession extends AiSession {
  key: string;
  history: OpenAI.Chat.ChatCompletionMessageParam[];
}

/** Placeholder swapped in for an evicted (stale) capture image in history. */
const IMG_PLACEHOLDER = "[이전 캡처 — 생략됨]";

/** data-URL image part for a captured frame (camera or doc-viewer page). */
function toImagePart(img: {
  bytes: Buffer;
  mimeType: string;
}): OpenAI.Chat.ChatCompletionContentPart {
  return {
    type: "image_url",
    image_url: {
      url: `data:${img.mimeType};base64,${img.bytes.toString("base64")}`,
    },
  };
}

/**
 * Return a copy of `history` where stale capture images become a text
 * placeholder, so re-sending the full history doesn't resend stale base64
 * frames. The most recent image-bearing user message keeps its images (a doc
 * capture and a camera frame sent together form one snapshot of that moment) —
 * unless the current turn carries fresh images, in which case no history image
 * survives. Works on a shallow copy (cloning only the user messages it edits)
 * so the live session history is never mutated — a turn that throws before it
 * commits must leave the previously retained images intact.
 */
function pruneOpenAiImages(
  history: OpenAI.Chat.ChatCompletionMessageParam[],
  currentTurnHasImages: boolean,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const copy = history.map((msg) =>
    msg.role === "user" && Array.isArray(msg.content)
      ? { ...msg, content: [...msg.content] }
      : msg,
  );
  let keepNewest = !currentTurnHasImages;
  for (let i = copy.length - 1; i >= 0; i--) {
    const msg = copy[i];
    if (!msg || msg.role !== "user" || !Array.isArray(msg.content)) continue;
    if (!msg.content.some((p) => p?.type === "image_url")) continue;
    if (keepNewest) {
      keepNewest = false;
      continue;
    }
    for (let j = 0; j < msg.content.length; j++) {
      const part = msg.content[j];
      if (part?.type === "image_url")
        msg.content[j] = { type: "text", text: IMG_PLACEHOLDER };
    }
  }
  return copy;
}

export function createOpenAiProvider(
  apiKey: string,
  cfg: AiConfig,
  tools: Tool[] = [],
): AiProvider {
  const client = new OpenAI({ apiKey });
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const toolDefs: OpenAI.Chat.ChatCompletionTool[] | undefined =
    tools.length > 0
      ? tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        }))
      : undefined;

  return {
    name: "openai",
    createSession(): OpenAiSession {
      return { key: randomUUID(), history: [] };
    },
    async warmup(): Promise<void> {
      await client.models.list();
    },
    async classify({
      prompt,
      image,
      maxTokens,
    }: AiClassifyInput): Promise<string> {
      // No system prompt, no history, no tools: this is a polled label lookup,
      // not part of the conversation. `detail: "low"` bills the image at a
      // flat, small token count. reasoning_effort must mirror the configured
      // effort — reasoning models default to a non-trivial effort, spend the
      // whole tiny max_completion_tokens budget on reasoning and return empty
      // content, which parses as the inert label so the check never fires.
      const res = await client.chat.completions.create({
        model: cfg.model,
        max_completion_tokens: maxTokens,
        ...(cfg.openaiReasoning
          ? { reasoning_effort: cfg.openaiReasoning as never }
          : {}),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`,
                  detail: "low",
                },
              },
            ],
          },
        ],
      });
      return res.choices[0]?.message?.content?.trim() ?? "";
    },
    async *stream(
      { prompt, image, document }: AiInput,
      session: AiSession,
    ): AsyncIterable<string> {
      // `session` is always one this provider issued via createSession().
      const s = session as OpenAiSession;
      // Evict stale images from a COPY of history (committed only on success).
      const history = pruneOpenAiImages(
        s.history,
        image !== undefined || document !== undefined,
      );
      // Each attached image is preceded by its label text part so the model can
      // tell the doc-viewer capture from the camera frame (see ./types.ts).
      const parts: OpenAI.Chat.ChatCompletionContentPart[] = [
        { type: "text", text: prompt },
      ];
      if (document) {
        parts.push(
          { type: "text", text: DOCUMENT_IMAGE_LABEL },
          toImagePart(document),
        );
      }
      if (image) {
        parts.push(
          { type: "text", text: CAMERA_IMAGE_LABEL },
          toImagePart(image),
        );
      }
      const userMessage: OpenAI.Chat.ChatCompletionMessageParam =
        parts.length > 1
          ? { role: "user", content: parts }
          : { role: "user", content: prompt };
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: cfg.systemPrompt },
        ...history,
        userMessage,
      ];

      // Agentic loop: stream text, and whenever the model emits tool calls,
      // run them, append the results, and continue until it answers in text.
      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const stream = await client.chat.completions.create({
          model: cfg.model,
          stream: true,
          messages,
          ...(toolDefs ? { tools: toolDefs } : {}),
          ...(cfg.openaiReasoning
            ? { reasoning_effort: cfg.openaiReasoning as never }
            : {}),
        });

        let content = "";
        const calls: { id: string; name: string; args: string }[] = [];
        let finishReason: string | null = null;

        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (!choice) continue;
          const delta = choice.delta;
          if (typeof delta?.content === "string" && delta.content.length > 0) {
            content += delta.content;
            yield delta.content;
          }
          for (const tc of delta?.tool_calls ?? []) {
            const slot = (calls[tc.index] ??= { id: "", name: "", args: "" });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }

        const toolCalls = calls.filter((c) => c && c.id && c.name);
        if (finishReason !== "tool_calls" || toolCalls.length === 0) {
          // Final answer: record the assistant turn so the session remembers it.
          if (content.length > 0) messages.push({ role: "assistant", content });
          break;
        }

        // Record the assistant turn that requested the tools...
        messages.push({
          role: "assistant",
          content: content.length > 0 ? content : null,
          tool_calls: toolCalls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: c.args || "{}" },
          })),
        });

        // ...then run each tool and feed its result back.
        for (const call of toolCalls) {
          let input: unknown = {};
          try {
            input = call.args ? JSON.parse(call.args) : {};
          } catch {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: `error: invalid JSON arguments: ${call.args}`,
            });
            continue;
          }
          const result = await callTool(toolMap, call.name, input);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
      }

      // Persist the turn (everything after the system message) so the next call
      // continues the same conversation. System is re-prepended on each call.
      s.history = messages.slice(1);
    },
  };
}
