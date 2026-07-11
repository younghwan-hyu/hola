import type { RagConfig } from "../config.ts";
import { createOllamaEmbeddingsProvider } from "./ollama.ts";
import type { EmbeddingsProvider } from "./types.ts";

export function createEmbeddingsProvider(cfg: RagConfig): EmbeddingsProvider {
  switch (cfg.embeddingsProvider) {
    case "ollama":
      return createOllamaEmbeddingsProvider(cfg);
  }
}

export type { EmbeddingsProvider } from "./types.ts";
