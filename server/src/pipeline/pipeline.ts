import type { AiProvider } from "../ai/index.ts";
import type { SttProvider } from "../stt/index.ts";
import type { TtsProvider } from "../tts/index.ts";
import { SentenceSplitter } from "./sentence-splitter.ts";
import type { Session } from "./session.ts";

export interface PipelineDeps {
  stt: SttProvider;
  ai: AiProvider;
  tts: TtsProvider;
  sentenceBoundaryChars: string;
}

export interface PipelineInput {
  text?: string;
  audio?: { bytes: Buffer; mimeType?: string };
}

/**
 * STT (bulk) -> AI (streaming, sentence-split) -> TTS (streaming).
 *
 * Sentences are TTS'd sequentially (one at a time) but the AI stream keeps
 * running in parallel, queueing additional sentences as they complete. This
 * keeps the audio playback contiguous while letting the AI race ahead.
 */
export async function runPipeline(
  session: Session,
  input: PipelineInput,
  deps: PipelineDeps,
): Promise<void> {
  try {
    let userText: string;
    if (input.audio) {
      const sttStart = Date.now();
      const sttResult = await deps.stt.recognize({
        audio: input.audio.bytes,
        mimeType: input.audio.mimeType,
      });
      userText = sttResult.text;
      session.emit({ type: "stt", text: userText, source: "audio" });
      session.emit({ type: "timing", phase: "stt", ms: Date.now() - sttStart });
    } else if (input.text !== undefined) {
      userText = input.text;
      session.emit({ type: "stt", text: userText, source: "text" });
    } else {
      throw new Error("pipeline input requires either `text` or `audio`");
    }

    if (userText.trim().length === 0) {
      session.emit({ type: "done" });
      return;
    }

    const splitter = new SentenceSplitter(deps.sentenceBoundaryChars);
    let sentenceIdx = 0;
    let ttsChain: Promise<void> = Promise.resolve();
    let firstTtsCallTime: number | null = null;
    let ttsFirstChunkReported = false;

    const enqueueTts = (sentence: string): void => {
      const idx = sentenceIdx++;
      ttsChain = ttsChain.then(async () => {
        if (session.isClosed) return;
        if (firstTtsCallTime === null) firstTtsCallTime = Date.now();
        session.emit({ type: "tts_start", sentenceIdx: idx, text: sentence });
        for await (const chunk of deps.tts.stream({ text: sentence })) {
          if (session.isClosed) return;
          if (!ttsFirstChunkReported && firstTtsCallTime !== null) {
            ttsFirstChunkReported = true;
            session.emit({
              type: "timing",
              phase: "tts_first_chunk",
              ms: Date.now() - firstTtsCallTime,
            });
          }
          session.emit({
            type: "tts_chunk",
            sentenceIdx: idx,
            audio: Buffer.from(chunk).toString("base64"),
          });
        }
        session.emit({ type: "tts_end", sentenceIdx: idx });
      });
    };

    const aiStart = Date.now();
    let aiAccum = "";
    let aiTtftReported = false;
    for await (const delta of deps.ai.stream({ prompt: userText })) {
      if (!aiTtftReported) {
        aiTtftReported = true;
        session.emit({
          type: "timing",
          phase: "ai_ttft",
          ms: Date.now() - aiStart,
        });
      }
      aiAccum += delta;
      session.emit({ type: "ai_delta", text: delta });
      for (const sentence of splitter.push(delta)) {
        enqueueTts(sentence);
      }
    }
    const trailing = splitter.flush();
    if (trailing) enqueueTts(trailing);

    session.emit({ type: "ai_complete", text: aiAccum });
    session.emit({
      type: "timing",
      phase: "ai_total",
      ms: Date.now() - aiStart,
    });

    await ttsChain;
    if (firstTtsCallTime !== null) {
      session.emit({
        type: "timing",
        phase: "tts_total",
        ms: Date.now() - firstTtsCallTime,
      });
    }
    session.emit({ type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    session.emit({ type: "error", message });
  } finally {
    session.close();
  }
}
