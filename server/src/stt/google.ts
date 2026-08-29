import speech from "@google-cloud/speech";

import type { SttConfig } from "../config.ts";
import type { SttInput, SttProvider, SttResult, SttWord } from "./types.ts";

type Encoding = "OGG_OPUS" | "WEBM_OPUS" | "LINEAR16" | "FLAC" | "MP3";

function inferEncoding(mimeType: string | undefined): Encoding {
  const m = (mimeType ?? "").toLowerCase();
  if (m.includes("webm")) return "WEBM_OPUS";
  if (m.includes("ogg")) return "OGG_OPUS";
  // WAV (16-bit PCM): the RIFF header is accepted and the sample rate is read
  // from it. Not what the browser records, but handy for scripted tests.
  if (m.includes("wav")) return "LINEAR16";
  return "WEBM_OPUS";
}

/** protobuf Duration -> seconds. `seconds` arrives as number, string or Long. */
function durationSec(
  d: { seconds?: unknown; nanos?: unknown } | null | undefined,
): number {
  const s = d?.seconds;
  const secs =
    typeof s === "number"
      ? s
      : typeof s === "string"
        ? Number(s)
        : s && typeof s === "object" && "toNumber" in s
          ? (s as { toNumber(): number }).toNumber()
          : 0;
  const n = d?.nanos;
  return secs + (typeof n === "number" ? n / 1e9 : 0);
}

export function createGoogleSttProvider(cfg: SttConfig): SttProvider {
  const client = new speech.SpeechClient();

  return {
    name: "google",
    async warmup(): Promise<void> {
      // Opens auth + gRPC channel without a billable API call.
      await client.initialize();
    },
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
          // Per-word start/end times — free with the call, and what the voice
          // perception check measures pace and pauses from.
          enableWordTimeOffsets: true,
        },
        audio: { content: audio.toString("base64") },
      });

      const text =
        response.results
          ?.map((r) => r.alternatives?.[0]?.transcript ?? "")
          .filter((s) => s.length > 0)
          .join(" ") ?? "";

      const words: SttWord[] = [];
      for (const r of response.results ?? []) {
        for (const w of r.alternatives?.[0]?.words ?? []) {
          if (!w.word) continue;
          words.push({
            word: w.word,
            startSec: durationSec(w.startTime),
            endSec: durationSec(w.endTime),
          });
        }
      }

      return { text, words };
    },
  };
}
