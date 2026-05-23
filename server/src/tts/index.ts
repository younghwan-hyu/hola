import type { TtsConfig } from "../config.ts";
import { createGoogleTtsProvider } from "./google.ts";
import type { TtsProvider } from "./types.ts";

export function createTtsProvider(cfg: TtsConfig): TtsProvider {
  switch (cfg.provider) {
    case "google":
      return createGoogleTtsProvider(cfg);
  }
}

export type { TtsProvider, TtsInput } from "./types.ts";
