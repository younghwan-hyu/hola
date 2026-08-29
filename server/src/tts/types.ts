export interface TtsInput {
  text: string;
}

export interface TtsProvider {
  readonly name: string;
  /**
   * Yields audio chunks as they arrive, encoded per the configured
   * `audioEncoding` (PCM int16 LE at `sampleRateHertz` by default, or OGG_OPUS).
   */
  stream(input: TtsInput): AsyncIterable<Uint8Array>;
  /** Pre-warm TLS / auth / connection so the first user request isn't cold. */
  warmup(): Promise<void>;
}
