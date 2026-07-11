export interface ChunkOptions {
  /** Max characters per chunk. */
  maxChars: number;
  /** Characters of overlap carried from the end of one chunk into the next. */
  overlap: number;
}

/** Sentence/line terminators we prefer to break on (KO/EN/CJK). */
const SENTENCE_END = /[.!?。！？\n]/g;

/**
 * Find a good break point within `slice` (a candidate chunk). Prefers, in order:
 * a paragraph break, the last sentence terminator, the last whitespace. Returns
 * the exclusive end index, or `slice.length` if no boundary beats `minEnd`.
 */
function findBoundary(slice: string, minEnd: number): number {
  const para = slice.lastIndexOf("\n\n");
  if (para >= minEnd) return para + 2;

  let sentence = -1;
  SENTENCE_END.lastIndex = 0;
  for (let m = SENTENCE_END.exec(slice); m; m = SENTENCE_END.exec(slice)) {
    if (m.index + 1 >= minEnd) sentence = m.index + 1;
  }
  if (sentence >= minEnd) return sentence;

  const space = slice.lastIndexOf(" ");
  if (space >= minEnd) return space + 1;

  return slice.length;
}

/**
 * Split text into overlapping chunks, snapping chunk ends to natural
 * boundaries (paragraph > sentence > whitespace) where possible and hard-cutting
 * otherwise. Pure and deterministic. Empty/whitespace-only input yields `[]`.
 */
export function chunkText(text: string, opts: ChunkOptions): string[] {
  const maxChars = Math.max(1, Math.floor(opts.maxChars));
  const overlap = Math.min(Math.max(0, Math.floor(opts.overlap)), maxChars - 1);
  const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (clean.length === 0) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      // Prefer a boundary in the back half of the window so chunks stay sizeable.
      const window = clean.slice(start, end);
      const boundary = findBoundary(window, Math.floor(maxChars / 2));
      end = start + boundary;
    }
    const piece = clean.slice(start, end).trim();
    if (piece.length > 0) chunks.push(piece);
    if (end >= clean.length) break;
    // Step forward with overlap, but always make progress.
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
