import type { SttWord } from "../stt/types.ts";
import type {
  PerceptionVerdict,
  VoiceAnalysisInput,
  VoiceCheck,
} from "./types.ts";

/**
 * How did the user SOUND in the turn they just spoke?
 *
 * Two things, both measured against how this user usually sounds in this
 * conversation (a per-session baseline — pitch and pace differ too much
 * between people for absolute thresholds to mean anything):
 *
 *  - pace   → `hesitant`: noticeably slower than usual AND either more pausing
 *             or a longer wait before starting to speak. Rate = syllables of
 *             the transcript per second of actual speech (the browser's VAD);
 *             the STT word timings (free — the STT call is made anyway) give
 *             the spoken span and the lead-in.
 *  - tone   → `flat`: pitch that barely moves AND quieter than usual, i.e. a
 *             low, monotone delivery. Comes from the tone features the browser
 *             measured on its recording (web/src/lib/voice.ts).
 *
 * Unlike the camera checks this never speaks up on its own: the verdict is
 * appended to the very turn it describes, so the answer to that turn adapts
 * (shorter and simpler for `hesitant`; brief plus a light check-in for
 * `flat`). No model call, no extra latency.
 *
 * The first two voice turns only calibrate. Every turn updates the baseline
 * (flagged ones with a lighter weight), so someone who always talks slowly is
 * not "hesitant" — only slower than their own usual.
 */

/** Per-conversation running average of how the user speaks. */
interface Baseline {
  turns: number;
  rate: number; // syllables per second of speech
  pauseRatio: number; // paused seconds / spoken span
  leadSec: number; // silence before the first word
  f0Std: number | null; // pitch spread (Hz)
  rms: number | null; // loudness (0..1)
}

/** Everything one turn yields; `null` where the source gave nothing. */
export interface VoiceMetrics {
  syllables: number;
  speechSec: number;
  rate: number;
  pauseRatio: number;
  leadSec: number;
  f0Std: number | null;
  rms: number | null;
}

const LABEL_TEXT = {
  normal: "평소와 비슷함",
  hesitant: "느리고 머뭇거림",
  flat: "낮고 단조로움",
} as const;

const SIGNALS: Readonly<Record<string, string>> = {
  hesitant: "(perception: 사용자의 말이 평소보다 느리고 머뭇거립니다)",
  flat: "(perception: 사용자의 목소리가 평소보다 낮고 단조롭습니다)",
};

/** Turns that only build the baseline before any verdict is drawn. */
export const CALIBRATION_TURNS = 2;
/** Too little speech to judge pace or tone — treated as `normal`. */
const MIN_SYLLABLES = 4;
const MIN_SPEECH_SEC = 1.0;
/** A gap between consecutive words at least this long counts as a pause. */
const PAUSE_SEC = 0.35;
/** Below this many voiced frames the pitch statistics are noise. */
const MIN_VOICED_RATIO = 0.3;
/** EMA weights: a normal turn moves the baseline more than a flagged one. */
const EMA_NORMAL = 0.3;
const EMA_FLAGGED = 0.15;

// Thresholds are ratios against the baseline (see analyze) plus absolute
// backstops so an extreme turn is caught even during a drifted baseline.
const SLOW_RATIO = 0.75; // rate below 75% of usual
const PAUSE_EXTRA = 0.12; // pause ratio more than 12 points above usual
const LEAD_EXTRA_SEC = 1.0; // waited a second longer than usual to start
const VERY_SLOW_RATE = 2.0; // syllables/s — conversational Korean is ~4-6
const VERY_PAUSY_RATIO = 0.45;
const FLAT_F0_RATIO = 0.6; // pitch spread below 60% of usual
const FLAT_RMS_RATIO = 0.8; // and quieter than 80% of usual

/**
 * Syllable count for pacing: one per Hangul syllable block, one per Latin
 * vowel group, one per digit. Rough for English but pace is judged relative
 * to the user's own baseline, so only consistency matters.
 */
export function countSyllables(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xac00 && cp <= 0xd7a3) n++;
  }
  n += (text.match(/[aeiouy]+/gi) ?? []).length;
  n += (text.match(/\d/g) ?? []).length;
  return n;
}

/** Spoken span, paused seconds inside it and the wait before the first word. */
export function speechTiming(
  words: readonly SttWord[],
): { spanSec: number; pauseSec: number; leadSec: number } | null {
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) return null;
  let pauseSec = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = (words[i]?.startSec ?? 0) - (words[i - 1]?.endSec ?? 0);
    if (gap >= PAUSE_SEC) pauseSec += gap;
  }
  return {
    spanSec: Math.max(0, last.endSec - first.startSec),
    pauseSec,
    leadSec: Math.max(0, first.startSec),
  };
}

/**
 * The numbers one turn is judged on, or null when there's too little speech.
 *
 * Pauses come from the browser's VAD, not from gaps in the STT word timings:
 * Google stretches each word's end time up to the next word's start, so the
 * timings show no gaps at all (a 14 s clip with four long breaks reported
 * pause=0). The STT timings still give the spoken span and the lead-in; the
 * VAD's speech seconds inside that span give the pauses and the true rate.
 */
export function measure(input: VoiceAnalysisInput): VoiceMetrics | null {
  const syllables = countSyllables(input.transcript);
  const timing = speechTiming(input.words);
  const f = input.features;
  const spanSec = timing?.spanSec ?? f?.durationSec ?? 0;
  // Speech seconds: VAD when we have it, else the STT span minus its (rarely
  // reported) gaps.
  const speechSec =
    f !== undefined
      ? Math.min(f.speechSec, spanSec > 0 ? spanSec : f.speechSec)
      : timing
        ? timing.spanSec - timing.pauseSec
        : 0;
  if (syllables < MIN_SYLLABLES || speechSec < MIN_SPEECH_SEC) return null;
  const pauseSec = Math.max(
    timing?.pauseSec ?? 0,
    spanSec > 0 ? spanSec - speechSec : 0,
  );
  const tonal =
    f !== undefined && f.voicedRatio >= MIN_VOICED_RATIO && f.f0StdHz !== null;
  return {
    syllables,
    speechSec,
    rate: syllables / speechSec,
    pauseRatio: spanSec > 0 ? Math.min(1, pauseSec / spanSec) : 0,
    leadSec: timing?.leadSec ?? 0,
    f0Std: tonal ? f.f0StdHz : null,
    rms: tonal ? f.rmsMean : null,
  };
}

const ema = (prev: number, next: number, alpha: number): number =>
  prev + alpha * (next - prev);

const emaNullable = (
  prev: number | null,
  next: number | null,
  alpha: number,
): number | null =>
  next === null ? prev : prev === null ? next : ema(prev, next, alpha);

export function createVoiceCheck(): VoiceCheck {
  const baselines = new Map<string, Baseline>();

  return {
    name: "voice",
    label: "목소리 톤 인식",
    description: "목소리가 평소보다 느리거나 낮은지 확인합니다.",
    // Nothing optional to switch on: speaking is how the app is used.
    requires: [],
    trigger: { kind: "turn", input: "voice" },
    // Judged against this user's baseline, not a fixed threshold (see above).
    relative: true,
    labelText: LABEL_TEXT,
    // Attached to the user's own message, so the rule is about HOW to answer
    // that message — never about the notice itself.
    guidance:
      "- 사용자 메시지 끝에 '말이 평소보다 느리고 머뭇거린다'는 알림이 붙어 오면: 그 메시지에는 딱 세 문장으로만 답하라 — 첫 두 문장은 쉬운 말로 핵심 하나만, 세 번째 문장은 이해됐는지 묻는 짧은 질문 (예: \"페이지 폴트는 필요한 페이지가 메모리에 없을 때 생깁니다. 그러면 운영체제가 디스크에서 그 페이지를 가져온 뒤 다시 실행합니다. 여기까지 이해되셨나요?\"). 배경 설명·예시·정리는 생략하고, 사용자가 더 묻거나 이해됐다고 하면 그때 이어서 설명하라.\n- 사용자 메시지 끝에 '목소리가 평소보다 낮고 단조롭다'는 알림이 붙어 오면: 그 메시지에는 **두세 문장**으로 핵심만 답하고, 끝에 컨디션이 괜찮은지 또는 잠시 쉬었다 할지 한마디로 가볍게 물어라.",
    analyze(input, sessionKey): PerceptionVerdict {
      const m = measure(input);
      if (!m) return { label: "normal", text: "짧아서 판단하지 않음" };

      const base = baselines.get(sessionKey);
      let label: keyof typeof LABEL_TEXT = "normal";
      if (base && base.turns >= CALIBRATION_TURNS) {
        const slow = m.rate < base.rate * SLOW_RATIO;
        const pausy =
          m.pauseRatio > base.pauseRatio + PAUSE_EXTRA ||
          m.leadSec > base.leadSec + LEAD_EXTRA_SEC;
        if (
          (slow && pausy) ||
          m.rate < VERY_SLOW_RATE ||
          m.pauseRatio > VERY_PAUSY_RATIO
        ) {
          label = "hesitant";
        } else if (
          m.f0Std !== null &&
          m.rms !== null &&
          base.f0Std !== null &&
          base.rms !== null &&
          m.f0Std < base.f0Std * FLAT_F0_RATIO &&
          m.rms < base.rms * FLAT_RMS_RATIO
        ) {
          label = "flat";
        }
      }

      // Update the baseline with this turn (lighter when it was flagged).
      const alpha = label === "normal" ? EMA_NORMAL : EMA_FLAGGED;
      const next: Baseline = base
        ? {
            turns: base.turns + 1,
            rate: ema(base.rate, m.rate, alpha),
            pauseRatio: ema(base.pauseRatio, m.pauseRatio, alpha),
            leadSec: ema(base.leadSec, m.leadSec, alpha),
            f0Std: emaNullable(base.f0Std, m.f0Std, alpha),
            rms: emaNullable(base.rms, m.rms, alpha),
          }
        : {
            turns: 1,
            rate: m.rate,
            pauseRatio: m.pauseRatio,
            leadSec: m.leadSec,
            f0Std: m.f0Std,
            rms: m.rms,
          };
      baselines.set(sessionKey, next);

      console.log(
        `[hola] voice ${label} rate=${m.rate.toFixed(2)}/s pause=${m.pauseRatio.toFixed(2)} lead=${m.leadSec.toFixed(2)}s` +
          ` f0std=${m.f0Std?.toFixed(1) ?? "-"} rms=${m.rms?.toFixed(3) ?? "-"} (turn ${next.turns})`,
      );

      const calibrating = next.turns <= CALIBRATION_TURNS;
      return {
        label,
        text: calibrating
          ? `평소 목소리 익히는 중 (${next.turns}/${CALIBRATION_TURNS})`
          : LABEL_TEXT[label],
        ...(SIGNALS[label] ? { signal: SIGNALS[label] } : {}),
      };
    },
  };
}
