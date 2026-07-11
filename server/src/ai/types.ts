export interface AiInput {
  prompt: string;
  /**
   * Optional image captured from the user's camera this turn. Passed to the
   * model as a multimodal user message. The provider keeps only the most recent
   * image in history (older ones are replaced with a placeholder) since the full
   * history is re-sent on every call.
   */
  image?: { bytes: Buffer; mimeType: string };
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
   */
  stream(input: AiInput, session: AiSession): AsyncIterable<string>;
  /** Pre-warm TLS / auth / connection so the first user request isn't cold. */
  warmup(): Promise<void>;
}
