/**
 * Gesture commands the AI may emit inline in its response. The system prompt
 * (AI_SYSTEM_PROMPT) instructs the model to write them as `{gesture=NAME}`.
 *
 * Keep this set in sync with the client registry in web/src/lib/gestures.ts.
 */
export const KNOWN_GESTURES = new Set<string>([
  "expression_happy",
  "expression_sad",
  "action_wave",
  "show_sunny",
]);

const OPEN = "{gesture=";
const CLOSE = "}";

export interface ParsedChunk {
  /** Text to speak / display, with gesture markers removed. */
  text: string;
  /** Gesture names from completed `{gesture=NAME}` markers, in order. */
  gestures: string[];
}

/**
 * Streaming parser that separates spoken text from inline gesture commands of
 * the form `{gesture=NAME}`. Fed the AI's text deltas one at a time; a marker
 * may be split across deltas, so an incomplete one is buffered until the next
 * push()/flush(). Well-formed markers are always stripped from the text (so the
 * braces are never spoken) even if NAME is unknown — validity is checked by the
 * caller before emitting a gesture event.
 */
export class GestureCommandParser {
  private buffer = "";

  push(chunk: string): ParsedChunk {
    this.buffer += chunk;
    let text = "";
    const gestures: string[] = [];

    while (this.buffer.length > 0) {
      const open = this.buffer.indexOf("{");
      if (open === -1) {
        // No marker possible — flush everything.
        text += this.buffer;
        this.buffer = "";
        break;
      }

      // Plain text before the '{' is always safe to emit.
      text += this.buffer.slice(0, open);
      this.buffer = this.buffer.slice(open); // buffer now starts with '{'

      if (OPEN.startsWith(this.buffer)) {
        // A partial (or exact) open token with nothing after it yet — wait.
        break;
      }
      if (this.buffer.startsWith(OPEN)) {
        const close = this.buffer.indexOf(CLOSE, OPEN.length);
        if (close === -1) break; // marker not closed yet — wait for more
        const name = this.buffer.slice(OPEN.length, close).trim();
        if (name) gestures.push(name);
        this.buffer = this.buffer.slice(close + 1);
        continue;
      }

      // A literal '{' that is not the start of a gesture marker — emit it.
      text += "{";
      this.buffer = this.buffer.slice(1);
    }

    return { text, gestures };
  }

  /** Flush any buffered remainder as text (e.g. a marker truncated at EOF). */
  flush(): ParsedChunk {
    const text = this.buffer;
    this.buffer = "";
    return { text, gestures: [] };
  }
}
