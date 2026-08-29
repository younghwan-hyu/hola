/**
 * Tone features of a voice recording, measured in the browser.
 *
 * The browser already holds the recording it is about to upload, so measuring
 * it here is free — the server would need an Opus decoder to do the same. The
 * numbers travel with the turn (`voice` form field of POST /api/chat) and the
 * server's voice perception check compares them with how this user usually
 * sounds (server/src/perception/voice.ts). Pace and pauses are NOT measured
 * here: the server gets those from the STT word timings.
 *
 * Deliberately simple signal processing, no library:
 *  - decode → mono → 8 kHz (plenty for 60–400 Hz pitch and energy)
 *  - 25 ms frames every 10 ms → RMS; frames above an adaptive floor are speech
 *  - on speech frames, pitch by normalised autocorrelation over a 40 ms window
 *    (clarity-gated so unvoiced/noisy frames don't count)
 */

export interface VoiceFeatures {
  /** Length of the recording (s). */
  durationSec: number;
  /** Seconds of speech frames (energy above the floor). */
  speechSec: number;
  /** Mean RMS over speech frames (0..1; depends on mic gain — compare per user). */
  rmsMean: number;
  /** Mean / spread of the fundamental frequency over voiced frames (Hz). */
  f0MeanHz: number | null;
  f0StdHz: number | null;
  /** Voiced frames / speech frames. */
  voicedRatio: number;
}

const SAMPLE_RATE = 8000;
const MAX_SECONDS = 30; // longer recordings: measure the first 30 s
const FRAME_SEC = 0.025;
const HOP_SEC = 0.01;
const PITCH_WINDOW_SEC = 0.04;
const PITCH_EVERY_FRAMES = 2; // pitch on every other frame (20 ms) — cheaper
const F0_MIN_HZ = 60;
const F0_MAX_HZ = 400;
/** Normalised autocorrelation peak needed to call a frame voiced. */
const VOICED_CLARITY = 0.6;
/** A shorter-lag peak this close to the maximum wins (octave-error guard). */
const OCTAVE_TOLERANCE = 0.9;
/** Speech = RMS above max(this, 3× the quiet-frame floor). */
const SPEECH_RMS_MIN = 0.01;

/**
 * Pitch (Hz) of one window by normalised autocorrelation, or null when no lag
 * correlates clearly enough (unvoiced, silence, noise). Parabolic interpolation
 * around the best lag gives sub-sample precision, which matters at 8 kHz.
 */
function estimatePitch(
  x: Float32Array,
  start: number,
  win: number,
  sampleRate: number,
): number | null {
  const lagMin = Math.floor(sampleRate / F0_MAX_HZ);
  const lagMax = Math.min(Math.ceil(sampleRate / F0_MIN_HZ), win - 1);
  let bestLag = -1;
  let best = 0;
  const corr = new Float64Array(lagMax + 1);
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let r = 0;
    let e0 = 0;
    let e1 = 0;
    for (let t = start; t < start + win - lag; t++) {
      const a = x[t] ?? 0;
      const b = x[t + lag] ?? 0;
      r += a * b;
      e0 += a * a;
      e1 += b * b;
    }
    const norm = Math.sqrt(e0 * e1);
    const c = norm > 0 ? r / norm : 0;
    corr[lag] = c;
    if (c > best) {
      best = c;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || best < VOICED_CLARITY) return null;
  // Octave guard: a periodic signal correlates just as well at 2T as at T, so
  // the global maximum alone often lands an octave low. Take the SHORTEST lag
  // whose local peak comes within OCTAVE_TOLERANCE of the maximum instead.
  let lag = bestLag;
  const accept = best * OCTAVE_TOLERANCE;
  for (let l = lagMin + 1; l < bestLag; l++) {
    const c = corr[l] ?? 0;
    if (c >= accept && c >= (corr[l - 1] ?? 0) && c >= (corr[l + 1] ?? 0)) {
      lag = l;
      break;
    }
  }
  const peak = corr[lag] ?? best;
  // Parabolic refinement of the peak.
  const l = corr[lag - 1] ?? peak;
  const r = corr[lag + 1] ?? peak;
  const denom = l - 2 * peak + r;
  const shift = denom !== 0 ? (0.5 * (l - r)) / denom : 0;
  return sampleRate / (lag + shift);
}

/** Pure feature extraction on mono samples; exported so it can be tested without a browser. */
export function extractVoiceFeatures(
  samples: Float32Array,
  sampleRate: number,
): VoiceFeatures {
  const n = Math.min(samples.length, Math.floor(MAX_SECONDS * sampleRate));
  const frame = Math.round(FRAME_SEC * sampleRate);
  const hop = Math.round(HOP_SEC * sampleRate);
  const win = Math.round(PITCH_WINDOW_SEC * sampleRate);
  const durationSec = samples.length / sampleRate;

  const rms: number[] = [];
  for (let s = 0; s + frame <= n; s += hop) {
    let sum = 0;
    for (let t = s; t < s + frame; t++) {
      const v = samples[t] ?? 0;
      sum += v * v;
    }
    rms.push(Math.sqrt(sum / frame));
  }
  if (rms.length === 0) {
    return {
      durationSec,
      speechSec: 0,
      rmsMean: 0,
      f0MeanHz: null,
      f0StdHz: null,
      voicedRatio: 0,
    };
  }

  // Adaptive energy floor: the quietest fifth of the frames is background.
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const threshold = Math.max(SPEECH_RMS_MIN, floor * 3);

  let speechFrames = 0;
  let rmsSum = 0;
  let pitched = 0; // speech frames where pitch was attempted
  const f0s: number[] = [];
  for (let i = 0; i < rms.length; i++) {
    const r = rms[i] ?? 0;
    if (r < threshold) continue;
    speechFrames++;
    rmsSum += r;
    if (i % PITCH_EVERY_FRAMES !== 0) continue;
    const start = i * hop;
    if (start + win > n) continue;
    pitched++;
    const f0 = estimatePitch(samples, start, win, sampleRate);
    if (f0 !== null) f0s.push(f0);
  }

  let f0MeanHz: number | null = null;
  let f0StdHz: number | null = null;
  if (f0s.length > 0) {
    const mean = f0s.reduce((a, b) => a + b, 0) / f0s.length;
    const varSum = f0s.reduce((a, b) => a + (b - mean) * (b - mean), 0);
    f0MeanHz = mean;
    f0StdHz = Math.sqrt(varSum / f0s.length);
  }
  return {
    durationSec,
    speechSec: speechFrames * HOP_SEC,
    rmsMean: speechFrames > 0 ? rmsSum / speechFrames : 0,
    f0MeanHz,
    f0StdHz,
    voicedRatio: pitched > 0 ? f0s.length / pitched : 0,
  };
}

/**
 * Decode a recording (whatever MediaRecorder produced) and measure it. Resolves
 * null when the browser can't decode it — the turn is still sent, the server
 * just has less to go on.
 */
export async function analyzeVoice(blob: Blob): Promise<VoiceFeatures | null> {
  try {
    const bytes = await blob.arrayBuffer();
    // decodeAudioData resamples to the context's rate, so decode straight at 8 kHz.
    const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    const audio = await ctx.decodeAudioData(bytes);
    const len = audio.length;
    const mono = new Float32Array(len);
    const channels = audio.numberOfChannels;
    for (let c = 0; c < channels; c++) {
      const data = audio.getChannelData(c);
      for (let i = 0; i < len; i++)
        mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / channels;
    }
    return extractVoiceFeatures(mono, audio.sampleRate);
  } catch (e) {
    console.warn("voice analysis failed", e);
    return null;
  }
}
