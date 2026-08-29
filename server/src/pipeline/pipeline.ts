import type { AiProvider, AiSession } from "../ai/index.ts";
import type { VoiceCheck, VoiceFeatures } from "../perception/index.ts";
import type { SttProvider, SttWord } from "../stt/index.ts";
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
  /** Turn-driven voice checks (perception/voice.ts); run on spoken turns. */
  voiceChecks: readonly VoiceCheck[];
}

export interface PipelineInput {
  text?: string;
  audio?: { bytes: Buffer; mimeType?: string };
  /** Optional camera frame to send alongside this turn (see AiInput.image). */
  image?: { bytes: Buffer; mimeType: string };
  /** Optional doc-viewer page capture for this turn (see AiInput.document). */
  document?: { bytes: Buffer; mimeType: string };
  /**
   * Spoken turns only: the tone features the browser measured on its recording
   * and the names of the voice checks the user has switched on. Absent when
   * the client sent none — then no voice check runs.
   */
  voice?: { features?: VoiceFeatures; checks: readonly string[] };
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
    let words: SttWord[] = [];
    if (input.audio) {
      const sttStart = Date.now();
      const sttResult = await deps.stt.recognize({
        audio: input.audio.bytes,
        mimeType: input.audio.mimeType,
      });
      userText = sttResult.text;
      words = sttResult.words;
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

    // Voice checks judge HOW this turn was spoken (pace from the STT word
    // timings, tone from the browser's measurements) and, when it stands out,
    // annotate the turn itself so the answer to it adapts — the model sees what
    // was said plus how it sounded, in one message, with no extra round-trip.
    // Only spoken turns, and only the checks the client has switched on. The
    // `stt` event above carries the bare transcript, so the user bubble never
    // shows the annotation.
    let prompt = userText;
    if (input.audio && input.voice) {
      for (const check of deps.voiceChecks) {
        if (!input.voice.checks.includes(check.name)) continue;
        const verdict = check.analyze(
          { transcript: userText, words, features: input.voice.features },
          deps.aiSession.key,
        );
        session.emit({
          type: "perception",
          check: check.name,
          label: verdict.label,
          text: verdict.text ?? verdict.label,
          ...(verdict.signal ? { signal: verdict.signal } : {}),
        });
        if (verdict.signal) prompt += `\n\n${verdict.signal}`;
      }
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
      { prompt, image: input.image, document: input.document },
      deps.aiSession,
      session.signal,
    )) {
      // The client left mid-answer (stop button, closed tab). Breaking here
      // closes the provider's stream too; `signal` normally gets there first,
      // so this is the backstop for a provider that ignores it. Queued TTS
      // sentences drop out on their own — the chain checks isClosed.
      if (session.aborted) break;
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
    // An abort can surface here as the provider's cancellation error (Anthropic
    // throws it; OpenAI just ends the stream). That's the client leaving, not a
    // failure: nobody is left to report it to, and abort() already logged it.
    if (!session.aborted) {
      const message = err instanceof Error ? err.message : String(err);
      session.emit({ type: "error", message });
    }
  } finally {
    session.close();
  }
}
