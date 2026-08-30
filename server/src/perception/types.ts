import type { SttWord } from "../stt/types.ts";

/** One camera frame handed to a camera perception check. */
export interface PerceptionInput {
  image: { bytes: Buffer; mimeType: string };
}

/**
 * A browser-side capability a check can't run without — something OPTIONAL the
 * user has to switch on. Only the camera qualifies: speaking is the app's own
 * primary input, so a voice check requires nothing extra and shows no badge.
 */
export type PerceptionRequirement = "camera";

/** Polled: the client samples on a timer for as long as the check can run. */
export interface PollTrigger {
  kind: "poll";
  /**
   * How often the client samples while the check is able to run. Checks poll
   * independently of each other (their requests may overlap); the client only
   * skips a tick whose previous request for the SAME check is still pending.
   */
  intervalMs: number;
  /**
   * How many consecutive triggering verdicts before acting. 1 fires on the
   * first one; raise it to debounce a check that flickers.
   */
  consecutive: number;
}

/**
 * Turn-driven: the check runs once per user turn of the given input kind —
 * today, every turn the user speaks — on that turn itself, before the model
 * answers it. Nothing is polled.
 */
export interface TurnTrigger {
  kind: "turn";
  input: "voice";
}

/**
 * How the browser drives a check. A tagged shape so the client can tell a
 * polled camera check from a turn-driven one without knowing either by name.
 */
export type PerceptionTrigger = PollTrigger | TurnTrigger;

/** Long edge (px) / JPEG quality of the camera frame the client should send. */
export interface PerceptionFrameSpec {
  maxPx: number;
  quality: number;
}

/**
 * The part of a check the browser needs in order to run it. Returned by
 * `GET /api/perception` — prompts, rules and thresholds stay on the server.
 */
export interface PerceptionCheckInfo {
  /** Stable id; for camera checks also the path segment of `POST /api/perception/:name`. */
  name: string;
  /**
   * Human-readable name and one-line description, shown in the web client's
   * 상황 인지 modal where the user switches checks on and off. They live here
   * rather than in the client so "one check = one file" still holds: a new
   * check brings its own wording and appears in the modal with no client change.
   */
  label: string;
  description: string;
  /**
   * What the browser must have for this check to run at all. The client shows
   * a badge per entry ("카메라 필요") and only drives the check while every
   * requirement is met — a camera check that is switched on simply waits, and
   * says so, until the camera comes on. Empty for voice checks.
   */
  requires: readonly PerceptionRequirement[];
  /** How the check is driven (and, for polling, how often). Shown as a badge. */
  trigger: PerceptionTrigger;
  /**
   * The check judges against the user's OWN usual (a per-session baseline it
   * builds as it goes) rather than an absolute rule. Shown as a "상대적 측정"
   * badge in the modal. Omitted (false) for the camera checks, which classify
   * each frame on its own.
   */
  relative?: boolean;
  /** Camera capture spec; present exactly when `requires` includes "camera". */
  frame?: PerceptionFrameSpec;
}

interface PerceptionCheckBase extends PerceptionCheckInfo {
  /**
   * This check's slice of the system prompt: what its signals mean and how the
   * avatar should react. Composed into the real system prompt by
   * `withPerceptionGuidance`, so a new check stays a single file.
   */
  guidance: string;
}

/**
 * A camera check: a one-shot "look at the camera and tell me X" classification
 * on a polled frame, answered by the vision model with one label.
 *
 * Adding one is meant to be a single file plus a line in
 * {@link createPerceptionChecks}: the route, the client polling loop and the
 * hand-off into the chat pipeline are all generic over this shape.
 */
export interface CameraCheck extends PerceptionCheckBase {
  trigger: PollTrigger;
  frame: PerceptionFrameSpec;
  /** Question put to the model. Must ask for exactly one of `labels`. */
  prompt: string;
  /**
   * The answers this check understands. `labels[0]` is also the fallback for an
   * answer that matches none of them, so it MUST be the inert one — an
   * unparseable reply should never make the avatar speak.
   */
  labels: readonly string[];
  /**
   * Labels that should make the avatar say something, mapped to the SIGNAL
   * injected into the chat pipeline — a plain-language status line such as
   * `(perception: 사용자가 카메라 화면에서 사라졌습니다)`, not an instruction
   * (and not a terse code like `presence=absent`, which the model answers with
   * "무슨 뜻인지 모르겠습니다"). How to react to it belongs in {@link guidance}:
   * orders smuggled into a user turn get ignored by the model.
   */
  triggers: Readonly<Record<string, string>>;
  /** Cap on the model's answer. A label is a token or two. */
  maxTokens: number;
}

/**
 * A voice check: runs on the turn the user just spoke, from numbers only — the
 * STT word timings and the tone features the browser measured — with no model
 * call. Its signal is not a separate nudge but an annotation appended to that
 * very turn, so the answer to it can adapt (see pipeline.ts).
 */
export interface VoiceCheck extends PerceptionCheckBase {
  trigger: TurnTrigger;
  /** Human-readable wording per label, shown in the client's status line. */
  labelText: Readonly<Record<string, string>>;
  /**
   * Judge one voice turn. `sessionKey` identifies the conversation whose
   * baseline (what this user's speech usually sounds like) to compare against
   * and update — the baseline lives on the server, next to the AI session.
   */
  analyze(input: VoiceAnalysisInput, sessionKey: string): PerceptionVerdict;
}

export type PerceptionCheck = CameraCheck | VoiceCheck;

export function isCameraCheck(check: PerceptionCheck): check is CameraCheck {
  return check.trigger.kind === "poll";
}

export function isVoiceCheck(check: PerceptionCheck): check is VoiceCheck {
  return check.trigger.kind === "turn";
}

/**
 * Tone features the browser extracts from its own recording before sending it
 * (web/src/lib/voice.ts): the browser already holds the decoded audio, so this
 * costs nothing, whereas the server would need an Opus decoder for the same.
 */
export interface VoiceFeatures {
  /** Length of the recording (s). */
  durationSec: number;
  /** Seconds of frames above the energy floor (a simple VAD). */
  speechSec: number;
  /** Mean RMS over speech frames (0..1, mic-gain dependent — compare per user). */
  rmsMean: number;
  /** Mean / spread of the fundamental frequency over voiced frames (Hz). */
  f0MeanHz: number | null;
  f0StdHz: number | null;
  /** Voiced frames / speech frames. Low = little tonal material to judge. */
  voicedRatio: number;
}

export interface VoiceAnalysisInput {
  transcript: string;
  /** Word timings from STT; empty when the provider returned none. */
  words: readonly SttWord[];
  /** Absent when the browser couldn't decode its recording. */
  features?: VoiceFeatures;
}

export interface PerceptionVerdict {
  /** One of the check's labels. */
  label: string;
  /** Human-readable wording of the label (voice checks), for the client UI. */
  text?: string;
  /**
   * Set only when this label should reach the model: for camera checks the
   * nudge injected as a hidden turn, for voice checks the annotation appended
   * to the turn that was analysed.
   */
  signal?: string;
}
