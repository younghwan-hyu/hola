import type { AiConfig } from "../config.ts";
import { createAnthropicProvider } from "./anthropic.ts";
import { createOpenAiProvider } from "./openai.ts";
import type { AiProvider } from "./types.ts";

export function createAiProvider(
  cfg: AiConfig,
  keys: { openaiKey: string; anthropicKey: string },
): AiProvider {
  switch (cfg.provider) {
    case "openai":
      return createOpenAiProvider(keys.openaiKey, cfg);
    case "anthropic":
      return createAnthropicProvider(keys.anthropicKey, cfg);
  }
}

export type { AiProvider, AiInput } from "./types.ts";
