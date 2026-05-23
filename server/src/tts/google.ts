import textToSpeech from "@google-cloud/text-to-speech";

import type { TtsConfig } from "../config.ts";
import type { TtsInput, TtsProvider } from "./types.ts";

interface StreamingResponse {
  audioContent?: Uint8Array | string | null;
}

export function createGoogleTtsProvider(cfg: TtsConfig): TtsProvider {
  const client = new textToSpeech.TextToSpeechClient();

  return {
    name: "google",
    async *stream({ text }: TtsInput): AsyncIterable<Uint8Array> {
      const stream = client.streamingSynthesize();

      stream.write({
        streamingConfig: {
          voice: { languageCode: cfg.language, name: cfg.voice },
          streamingAudioConfig: {
            audioEncoding: cfg.audioEncoding,
            sampleRateHertz: cfg.sampleRateHertz,
          },
        },
      });
      stream.write({ input: { text } });
      stream.end();

      for await (const resp of stream as AsyncIterable<StreamingResponse>) {
        const audio = resp.audioContent;
        if (!audio) continue;
        if (audio instanceof Uint8Array) {
          if (audio.length > 0) yield audio;
        } else if (typeof audio === "string") {
          const bytes = Buffer.from(audio, "base64");
          if (bytes.length > 0) yield bytes;
        }
      }
    },
  };
}
