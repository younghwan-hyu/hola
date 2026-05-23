export interface SttInput {
  audio: Buffer;
  /** e.g. "audio/webm;codecs=opus", "audio/ogg;codecs=opus". May be undefined. */
  mimeType?: string;
}

export interface SttResult {
  text: string;
}

export interface SttProvider {
  readonly name: string;
  recognize(input: SttInput): Promise<SttResult>;
  /** Pre-warm TLS / auth / connection so the first user request isn't cold. */
  warmup(): Promise<void>;
}
