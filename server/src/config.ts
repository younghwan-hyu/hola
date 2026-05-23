import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function optionalInt(name: string): number | undefined {
  const raw = optional(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid integer in env ${name}: ${raw}`);
  }
  return n;
}

export type SttProviderName = "google";
export type AiProviderName = "openai" | "anthropic";
export type TtsProviderName = "google";

export interface SttConfig {
  provider: SttProviderName;
  model: string;
  language: string;
  sampleRateHertz?: number;
}

export interface AiConfig {
  provider: AiProviderName;
  model: string;
  systemPrompt: string;
  openaiReasoning?: string;
  anthropicThinkingBudget?: number;
}

export type TtsAudioEncoding = "PCM" | "OGG_OPUS";

export interface TtsConfig {
  provider: TtsProviderName;
  voice: string;
  language: string;
  sampleRateHertz: number;
  audioEncoding: TtsAudioEncoding;
}

export interface Config {
  port: number;
  openaiKey: string;
  anthropicKey: string;
  stt: SttConfig;
  ai: AiConfig;
  tts: TtsConfig;
  sentenceBoundaryChars: string;
}

function parseStt(): SttConfig {
  const provider = (optional("STT_PROVIDER") ?? "google") as SttProviderName;
  if (provider !== "google") {
    throw new Error(`Unsupported STT_PROVIDER: ${provider}`);
  }
  return {
    provider,
    model: optional("STT_MODEL") ?? "latest_long",
    language: optional("STT_LANGUAGE") ?? "ko-KR",
    sampleRateHertz: optionalInt("STT_SAMPLE_RATE_HERTZ"),
  };
}

function parseAi(): AiConfig {
  const provider = (optional("AI_PROVIDER") ?? "openai") as AiProviderName;
  if (provider !== "openai" && provider !== "anthropic") {
    throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
  }
  return {
    provider,
    model: required("AI_MODEL"),
    systemPrompt:
      optional("AI_SYSTEM_PROMPT") ?? "You are a helpful assistant.",
    openaiReasoning: optional("AI_OPENAI_REASONING"),
    anthropicThinkingBudget: optionalInt("AI_ANTHROPIC_THINKING_BUDGET"),
  };
}

function parseTts(): TtsConfig {
  const provider = (optional("TTS_PROVIDER") ?? "google") as TtsProviderName;
  if (provider !== "google") {
    throw new Error(`Unsupported TTS_PROVIDER: ${provider}`);
  }
  const encoding = (optional("TTS_AUDIO_ENCODING") ?? "PCM") as TtsAudioEncoding;
  if (encoding !== "PCM" && encoding !== "OGG_OPUS") {
    throw new Error(`Unsupported TTS_AUDIO_ENCODING: ${encoding}`);
  }
  return {
    provider,
    voice: required("TTS_VOICE"),
    language: optional("TTS_LANGUAGE") ?? "ko-KR",
    sampleRateHertz: optionalInt("TTS_SAMPLE_RATE_HERTZ") ?? 24000,
    audioEncoding: encoding,
  };
}

export const config: Config = {
  port: optionalInt("PORT") ?? 3000,
  openaiKey: required("OPENAI_KEY"),
  anthropicKey: required("ANTHROPIC_KEY"),
  stt: parseStt(),
  ai: parseAi(),
  tts: parseTts(),
  sentenceBoundaryChars:
    optional("SENTENCE_BOUNDARY_CHARS") ?? ".,!?;:\n。，！？；：",
};
