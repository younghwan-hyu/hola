/** One camera frame handed to a perception check. */
export interface PerceptionInput {
  image: { bytes: Buffer; mimeType: string };
}

/**
 * The part of a check the browser needs in order to poll it. Returned by
 * `GET /api/perception` — the prompt and trigger lines stay on the server.
 */
export interface PerceptionCheckInfo {
  /** Stable id; also the path segment of `POST /api/perception/:name`. */
  name: string;
  /** How often the client samples a frame while the camera is on. */
  intervalMs: number;
  /**
   * How many consecutive triggering verdicts before acting. 1 fires on the
   * first one; raise it to debounce a check that flickers.
   */
  consecutive: number;
  /** Long edge (px) / JPEG quality of the frame the client should send. */
  frameMaxPx: number;
  frameQuality: number;
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
   * injected into the chat pipeline — a short `(perception:name=label)` token,
   * not an instruction. How to react to it belongs in {@link guidance}: orders
   * smuggled into a user turn get ignored by the model.
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
