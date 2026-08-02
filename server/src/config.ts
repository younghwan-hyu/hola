import dotenv from "dotenv";

import { buildSystemPrompt } from "./ai/system-prompt.ts";
import { KNOWN_GESTURES } from "./pipeline/gesture-parser.ts";

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
export type EmbeddingsProviderName = "ollama";

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

export interface RagConfig {
  /** postgres connection string for the pgvector-backed store. */
  databaseUrl: string;
  embeddingsProvider: EmbeddingsProviderName;
  /** Base URL of the self-hosted embedding server (Ollama). */
  embeddingsUrl: string;
  /** Model tag pulled/served by the embedding server. */
  embeddingsModel: string;
  /** Vector dimension the model emits; must match the model above. */
  embeddingDim: number;
  /** Max characters per chunk when splitting an uploaded document. */
  chunkSize: number;
  /** Character overlap between adjacent chunks. */
  chunkOverlap: number;
  /** Default number of chunks the search_documents tool returns. */
  topK: number;
}

export interface Config {
  port: number;
  openaiKey: string;
  anthropicKey: string;
  stt: SttConfig;
  ai: AiConfig;
  tts: TtsConfig;
  rag: RagConfig;
  sentenceBoundaryChars: string;
  /**
   * Gestures the AI may emit (subset of KNOWN_GESTURES). Drives both the
   * system-prompt gesture list and the pipeline's gesture-event filter. The
   * web client keeps every gesture implemented regardless.
   */
  gestures: string[];
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

/**
 * Gestures the AI may emit, from the GESTURES env var (comma-separated).
 * Unset -> every known gesture. Explicitly empty (`GESTURES=`) -> none, which
 * also drops the gesture instructions from the system prompt. Read directly
 * from process.env (not optional()) to tell "" apart from unset.
 */
function parseGestures(): string[] {
  const raw = process.env.GESTURES;
  if (raw === undefined) return [...KNOWN_GESTURES];
  const names = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const unknown = names.filter((n) => !KNOWN_GESTURES.has(n));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown gesture(s) in GESTURES: ${unknown.join(", ")} (valid: ${[...KNOWN_GESTURES].join(", ")})`,
    );
  }
  return [...new Set(names)]; // dedupe, preserve order
}

function parseAi(gestures: string[]): AiConfig {
  const provider = (optional("AI_PROVIDER") ?? "openai") as AiProviderName;
  if (provider !== "openai" && provider !== "anthropic") {
    throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
  }
  return {
    provider,
    model: required("AI_MODEL"),
    systemPrompt: buildSystemPrompt(gestures),
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

function parseRag(): RagConfig {
  const provider = (optional("EMBEDDINGS_PROVIDER") ??
    "ollama") as EmbeddingsProviderName;
  if (provider !== "ollama") {
    throw new Error(`Unsupported EMBEDDINGS_PROVIDER: ${provider}`);
  }
  const dim = optionalInt("EMBEDDING_DIM") ?? 1024;
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error(`Invalid EMBEDDING_DIM: ${dim}`);
  }
  const chunkSize = optionalInt("RAG_CHUNK_SIZE") ?? 800;
  const chunkOverlap = optionalInt("RAG_CHUNK_OVERLAP") ?? 150;
  if (chunkOverlap >= chunkSize) {
    throw new Error(
      `RAG_CHUNK_OVERLAP (${chunkOverlap}) must be smaller than RAG_CHUNK_SIZE (${chunkSize})`,
    );
  }
  return {
    databaseUrl:
      optional("DATABASE_URL") ?? "postgres://hola:hola@localhost:5432/hola",
    embeddingsProvider: provider,
    embeddingsUrl: optional("EMBEDDINGS_URL") ?? "http://localhost:11434",
    embeddingsModel:
      optional("EMBEDDINGS_MODEL") ?? "hf.co/Bingsu/KURE-v1-Q8_0-GGUF",
    embeddingDim: dim,
    chunkSize,
    chunkOverlap,
    topK: optionalInt("RAG_TOP_K") ?? 5,
  };
}

const gestures = parseGestures();

export const config: Config = {
  port: optionalInt("PORT") ?? 3000,
  openaiKey: required("OPENAI_KEY"),
  anthropicKey: required("ANTHROPIC_KEY"),
  stt: parseStt(),
  ai: parseAi(gestures),
  tts: parseTts(),
  rag: parseRag(),
  sentenceBoundaryChars:
    optional("SENTENCE_BOUNDARY_CHARS") ?? ".,!?;:\n。，！？；：",
  gestures,
};
