import type { SttConfig } from "../config.ts";
import { createGoogleSttProvider } from "./google.ts";
import type { SttProvider } from "./types.ts";

export function createSttProvider(cfg: SttConfig): SttProvider {
  switch (cfg.provider) {
    case "google":
      return createGoogleSttProvider(cfg);
  }
}

export type { SttProvider, SttInput, SttResult, SttWord } from "./types.ts";
