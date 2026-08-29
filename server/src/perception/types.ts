/** One camera frame handed to a perception check. */
export interface PerceptionInput {
  image: { bytes: Buffer; mimeType: string };
}

/** A browser-side capability a check can't run without. */
export type PerceptionRequirement = "camera";

/**
 * How the browser drives a check. Only polling exists today; it's a tagged
 * shape so a differently-driven check can be added later without the client
 * misreading its fields.
 */
export interface PerceptionTrigger {
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

/** Long edge (px) / JPEG quality of the camera frame the client should send. */
export interface PerceptionFrameSpec {
  maxPx: number;
  quality: number;
}

/**
 * The part of a check the browser needs in order to run it. Returned by
 * `GET /api/perception` — the prompt and trigger lines stay on the server.
 */
export interface PerceptionCheckInfo {
  /** Stable id; also the path segment of `POST /api/perception/:name`. */
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
   * says so, until the camera comes on.
   */
  requires: readonly PerceptionRequirement[];
  /** How the check is driven (and, for polling, how often). Shown as a badge. */
  trigger: PerceptionTrigger;
  /** Camera capture spec; required when `requires` includes "camera". */
  frame?: PerceptionFrameSpec;
}

/**
 * A one-shot "look at the camera and tell me X" classification.
 *
 * Adding one is meant to be a single file plus a line in
 * {@link createPerceptionChecks}: the route, the client polling loop and the
 * hand-off into the chat pipeline are all generic over this shape.
 */
export interface PerceptionCheck extends PerceptionCheckInfo {
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
  /**
   * This check's slice of the system prompt: what its signals mean and how the
   * avatar should react. Composed into the real system prompt by
   * `withPerceptionGuidance`, so a new check stays a single file.
   */
  guidance: string;
  /** Cap on the model's answer. A label is a token or two. */
  maxTokens: number;
}

export interface PerceptionVerdict {
  /** One of the check's `labels`. */
  label: string;
  /** Set only when this label should make the avatar speak (see `triggers`). */
  signal?: string;
}
