export interface TtsInput {
  text: string;
}

export interface TtsProvider {
  readonly name: string;
  /** Yields OGG_OPUS audio chunks as they arrive. */
  stream(input: TtsInput): AsyncIterable<Uint8Array>;
}
