import OpenAI from "openai";

import type { AiConfig } from "../config.ts";
import type { AiInput, AiProvider } from "./types.ts";

export function createOpenAiProvider(
  apiKey: string,
  cfg: AiConfig,
): AiProvider {
  const client = new OpenAI({ apiKey });

  return {
    name: "openai",
    async *stream({ prompt }: AiInput): AsyncIterable<string> {
      const stream = await client.chat.completions.create({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        stream: true,
        messages: [
          { role: "system", content: cfg.systemPrompt },
          { role: "user", content: prompt },
        ],
        ...(cfg.openaiReasoning
          ? { reasoning_effort: cfg.openaiReasoning as never }
          : {}),
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          yield delta;
        }
      }
    },
  };
}
