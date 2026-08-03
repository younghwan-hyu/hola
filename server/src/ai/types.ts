export interface AiInput {
  prompt: string;
  /**
   * Optional image captured from the user's camera this turn. Passed to the
   * model as a multimodal user message. Providers keep only the most recent
   * image-bearing turn's images in history (older ones are replaced with a
   * placeholder) since the full history is re-sent on every call.
   */
  image?: { bytes: Buffer; mimeType: string };
  /**
   * Optional capture of the document (PDF) page currently open in the web
   * client's doc-viewer mode. May accompany `image`; each attached image is
   * preceded by its label text part (below) so the model can tell a camera
   * frame from a document page. Pruned from history the same way as `image`.
   */
  document?: { bytes: Buffer; mimeType: string };
}

/**
 * Labels emitted as their own text part directly before each attached image.
 * The system prompt (./system-prompt.ts) explains them to the model; both
 * providers insert them when building multimodal user content.
 */
export const CAMERA_IMAGE_LABEL = "[카메라]";
export const DOCUMENT_IMAGE_LABEL = "[문서 화면]";

/** A one-shot look at an image, outside of any conversation. */
export interface AiClassifyInput {
  /** Question put to the model. Should demand exactly one short label. */
  prompt: string;
  image: { bytes: Buffer; mimeType: string };
  /** Cap on the answer — a label is a token or two. */
  maxTokens: number;
}

/**
 * A conversation session. `key` is issued when the session is created (at
 * server startup) and the session accumulates conversation history so that
 * successive `stream` calls continue the same conversation.
 *
 * The concrete history shape is provider-specific (OpenAI and Anthropic use
 * different message formats), so a session must only be passed back to the
 * provider that created it.
 */
export interface AiSession {
  readonly key: string;
}

export interface AiProvider {
  readonly name: string;
  /**
   * Issue a new conversation session with a fresh key and empty history. Call
   * once (e.g. at server startup) and reuse the returned session across
   * `stream` calls to carry conversation context.
   */
  createSession(): AiSession;
  /**
   * Yields text deltas as they arrive from the model. Appends both the user
   * turn and the assistant reply to `session` so context carries over to the
   * next call.
   *
   * `signal` cancels the in-flight provider call when the client goes away
   * (stop button, closed tab). An interrupted turn still commits what the model
   * managed to say — the user heard it, so the next turn has to know it was
   * said — but drops any half-finished tool round-trip.
   */
  stream(
    input: AiInput,
    session: AiSession,
    signal?: AbortSignal,
  ): AsyncIterable<string>;
  /**
   * Answer a single question about an image and return the raw text, trimmed.
   *
   * Deliberately session-less: no system prompt, no history, no tools, no
   * streaming and a hard token cap. Perception checks
   * (`server/src/perception`) poll this on a timer, so it must stay cheap and
   * must never write to the conversation.
   */
  classify(input: AiClassifyInput): Promise<string>;
  /** Pre-warm TLS / auth / connection so the first user request isn't cold. */
  warmup(): Promise<void>;
}
