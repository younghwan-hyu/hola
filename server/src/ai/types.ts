export interface AiInput {
  prompt: string;
}

export interface AiProvider {
  readonly name: string;
  /** Yields text deltas as they arrive from the model. */
  stream(input: AiInput): AsyncIterable<string>;
  /** Pre-warm TLS / auth / connection so the first user request isn't cold. */
  warmup(): Promise<void>;
}
