import { randomUUID } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";

import type { AiConfig } from "../config.ts";
import { MAX_TOOL_STEPS, callTool, type Tool } from "../tools/index.ts";
import type { AiInput, AiProvider, AiSession } from "./types.ts";

interface AnthropicSession extends AiSession {
  key: string;
  history: Anthropic.MessageParam[];
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
      { prompt }: AiInput,
      session: AiSession,
    ): AsyncIterable<string> {
      // `session` is always one this provider issued via createSession().
      const s = session as AnthropicSession;
      const messages: Anthropic.MessageParam[] = [
        ...s.history,
        { role: "user", content: prompt },
      ];

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
