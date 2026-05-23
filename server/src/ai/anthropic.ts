import Anthropic from "@anthropic-ai/sdk";

import type { AiConfig } from "../config.ts";
import type { AiInput, AiProvider } from "./types.ts";

export function createAnthropicProvider(
  apiKey: string,
  cfg: AiConfig,
): AiProvider {
  const client = new Anthropic({ apiKey });

  return {
    name: "anthropic",
    async warmup(): Promise<void> {
      // SDK 0.32.x has no models.list / countTokens — cheapest warm path is a
      // 1-token messages.create (~$0.0001 per startup).
      await client.messages.create({
        model: cfg.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      });
    },
    async *stream({ prompt }: AiInput): AsyncIterable<string> {
      const stream = client.messages.stream({
        model: cfg.model,
        max_tokens: 8192,
        system: cfg.systemPrompt,
        messages: [{ role: "user", content: prompt }],
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
    },
  };
}
