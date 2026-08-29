export interface SttInput {
  audio: Buffer;
  /** e.g. "audio/webm;codecs=opus", "audio/ogg;codecs=opus". May be undefined. */
  mimeType?: string;
}

/** One recognised word with its position in the recording (seconds). */
export interface SttWord {
  word: string;
  startSec: number;
  endSec: number;
}

export interface SttResult {
  text: string;
  /**
   * Word timings, when the provider returns them (Google: enableWordTimeOffsets).
   * Empty otherwise. The voice perception check reads pace and pauses off them.
   */
  words: SttWord[];
}

export interface SttProvider {
  readonly name: string;
  recognize(input: SttInput): Promise<SttResult>;
  /** Pre-warm TLS / auth / connection so the first user request isn't cold. */
  warmup(): Promise<void>;
}
