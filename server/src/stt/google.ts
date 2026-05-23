import speech from "@google-cloud/speech";

import type { SttConfig } from "../config.ts";
import type { SttInput, SttProvider, SttResult } from "./types.ts";

type Encoding = "OGG_OPUS" | "WEBM_OPUS" | "LINEAR16" | "FLAC" | "MP3";

function inferEncoding(mimeType: string | undefined): Encoding {
  const m = (mimeType ?? "").toLowerCase();
  if (m.includes("webm")) return "WEBM_OPUS";
  if (m.includes("ogg")) return "OGG_OPUS";
  return "WEBM_OPUS";
}

export function createGoogleSttProvider(cfg: SttConfig): SttProvider {
  const client = new speech.SpeechClient();

  return {
    name: "google",
    async recognize({ audio, mimeType }: SttInput): Promise<SttResult> {
      const [response] = await client.recognize({
        config: {
          encoding: inferEncoding(mimeType),
          ...(cfg.sampleRateHertz
            ? { sampleRateHertz: cfg.sampleRateHertz }
            : {}),
          languageCode: cfg.language,
          model: cfg.model,
          enableAutomaticPunctuation: true,
        },
        audio: { content: audio.toString("base64") },
      });

      const text =
        response.results
          ?.map((r) => r.alternatives?.[0]?.transcript ?? "")
          .filter((s) => s.length > 0)
          .join(" ") ?? "";

      return { text };
    },
  };
}
