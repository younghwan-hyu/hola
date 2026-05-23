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
    async *stream({ prompt }: AiInput): AsyncIterable<string> {
      const stream = client.messages.stream({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
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
