import type { AiConfig } from "../config.ts";
import type { Tool } from "../tools/index.ts";
import { createAnthropicProvider } from "./anthropic.ts";
import { createOpenAiProvider } from "./openai.ts";
import type { AiProvider } from "./types.ts";

export function createAiProvider(
  cfg: AiConfig,
  keys: { openaiKey: string; anthropicKey: string },
  tools: Tool[] = [],
): AiProvider {
  switch (cfg.provider) {
    case "openai":
      return createOpenAiProvider(keys.openaiKey, cfg, tools);
    case "anthropic":
      return createAnthropicProvider(keys.anthropicKey, cfg, tools);
  }
}

export type { AiProvider, AiInput, AiSession } from "./types.ts";
