/**
 * Accumulates streaming text deltas and emits sentences whenever a boundary
 * character (".,!?\n。，！？" etc.) is found.
 *
 * `push(delta)` returns 0+ complete sentences that should now be sent to TTS.
 * `flush()` returns the remaining buffer (if any) so the trailing fragment is
 * still spoken when the stream ends without a terminal boundary.
 */
export class SentenceSplitter {
  private buffer = "";
  private readonly boundary: Set<string>;

  constructor(boundaryChars: string) {
    this.boundary = new Set(boundaryChars);
  }

  push(delta: string): string[] {
    if (delta.length === 0) return [];
    this.buffer += delta;

    const sentences: string[] = [];
    let lastCut = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i]!;
      if (this.boundary.has(ch)) {
        const piece = this.buffer.slice(lastCut, i + 1).trim();
        if (piece.length > 0) sentences.push(piece);
        lastCut = i + 1;
      }
    }
    if (lastCut > 0) {
      this.buffer = this.buffer.slice(lastCut);
    }
    return sentences;
  }

  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest.length > 0 ? rest : null;
  }
}
