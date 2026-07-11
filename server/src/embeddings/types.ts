export interface EmbeddingsProvider {
  readonly name: string;
  /** The vector dimension this provider is configured to emit. */
  readonly dim: number;
  /**
   * Embed a batch of texts, returning one vector per input in order.
   * Implementations must reject if the server returns a dimension other than
   * `dim` so a model/schema mismatch surfaces loudly instead of corrupting the
   * vector store.
   */
  embed(texts: string[]): Promise<number[][]>;
  /** Pre-warm the connection / trigger model load so the first request isn't cold. */
  warmup(): Promise<void>;
}
