export interface AiInput {
  prompt: string;
}

export interface AiProvider {
  readonly name: string;
  /** Yields text deltas as they arrive from the model. */
  stream(input: AiInput): AsyncIterable<string>;
}
