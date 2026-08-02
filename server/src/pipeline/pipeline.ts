import type { AiProvider, AiSession } from "../ai/index.ts";
import type { SttProvider } from "../stt/index.ts";
import type { TtsProvider } from "../tts/index.ts";
import { GestureCommandParser, KNOWN_GESTURES } from "./gesture-parser.ts";
import { SentenceSplitter } from "./sentence-splitter.ts";
import type { Session } from "./session.ts";

export interface PipelineDeps {
  stt: SttProvider;
  ai: AiProvider;
  aiSession: AiSession;
  tts: TtsProvider;
  sentenceBoundaryChars: string;
  /** Gestures allowed through to the client (config.gestures, GESTURES env). */
  enabledGestures: ReadonlySet<string>;
}

export interface PipelineInput {
  text?: string;
  audio?: { bytes: Buffer; mimeType?: string };
  /** Optional camera frame to send alongside this turn (see AiInput.image). */
  image?: { bytes: Buffer; mimeType: string };
  /** Optional doc-viewer page capture for this turn (see AiInput.document). */
  document?: { bytes: Buffer; mimeType: string };
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

    // The AI streams spoken text with inline gesture commands ({gesture=NAME}).
    // Split them: clean text drives ai_delta + TTS, gestures become events.
    let aiAccum = "";
    let aiTextStarted = false;
    const gestureParser = new GestureCommandParser();
    const handleGestures = (names: string[]): void => {
      for (const name of names) {
        if (deps.enabledGestures.has(name)) {
          session.emit({ type: "gesture", name });
        } else if (KNOWN_GESTURES.has(name)) {
          // Valid but switched off via GESTURES — the model isn't told about
          // it, but if it emits one anyway don't let it through to the client.
          console.warn(`[pipeline] ignoring disabled gesture command: ${name}`);
        } else {
          console.warn(`[pipeline] ignoring unknown gesture command: ${name}`);
        }
      }
    };
    const handleText = (raw: string): void => {
      // Drop leading whitespace before the first real character so a stripped
      // leading gesture marker (e.g. "{gesture=...}\n안녕") doesn't leave a blank
      // line in the displayed/spoken text. Internal whitespace is preserved.
      let text = raw;
      if (!aiTextStarted) {
        text = text.replace(/^\s+/, "");
        if (!text) return;
        aiTextStarted = true;
      }
      if (!text) return;
      aiAccum += text;
      session.emit({ type: "ai_delta", text });
      for (const sentence of splitter.push(text)) {
        enqueueTts(sentence);
      }
    };

    const aiStart = Date.now();
    let aiTtftReported = false;
    for await (const delta of deps.ai.stream(
      { prompt: userText, image: input.image, document: input.document },
      deps.aiSession,
    )) {
      if (!aiTtftReported) {
        aiTtftReported = true;
        session.emit({
          type: "timing",
          phase: "ai_ttft",
          ms: Date.now() - aiStart,
        });
      }
      const { text, gestures } = gestureParser.push(delta);
      handleGestures(gestures);
      handleText(text);
    }
    handleText(gestureParser.flush().text);
    const trailing = splitter.flush();
    if (trailing) enqueueTts(trailing);

    session.emit({ type: "ai_complete", text: aiAccum.trim() });
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
