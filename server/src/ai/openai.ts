import { randomUUID } from "node:crypto";

import OpenAI from "openai";

import type { AiConfig } from "../config.ts";
import { MAX_TOOL_STEPS, callTool, type Tool } from "../tools/index.ts";
import type { AiInput, AiProvider, AiSession } from "./types.ts";

interface OpenAiSession extends AiSession {
  key: string;
  history: OpenAI.Chat.ChatCompletionMessageParam[];
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
    async *stream(
      { prompt }: AiInput,
      session: AiSession,
    ): AsyncIterable<string> {
      // `session` is always one this provider issued via createSession().
      const s = session as OpenAiSession;
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: cfg.systemPrompt },
        ...s.history,
        { role: "user", content: prompt },
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
