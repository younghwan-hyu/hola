/**
 * Perception checks — the server's "look at the camera and tell me X" probes.
 *
 * The browser doesn't know what any individual check means: it fetches the list
 * from the server, polls each one on its own interval while the camera is on,
 * and if a verdict comes back carrying a `signal`, hands that text to the
 * normal chat pipeline so the avatar says something. Adding a check server-side
 * needs no change here. See `server/src/perception/`.
 */

export interface PerceptionCheckInfo {
  name: string;
  /** How often to sample a frame while the camera is on. */
  intervalMs: number;
  /** Consecutive triggering verdicts required before acting (1 = immediately). */
  consecutive: number;
  /** Long edge (px) / JPEG quality of the frame to send. */
  frameMaxPx: number;
  frameQuality: number;
}

export interface PerceptionVerdict {
  label: string;
  /**
   * Set only when this verdict should make the avatar speak: a plain-language
   * status line (e.g. `(perception: 사용자가 카메라 화면에서 사라졌습니다)`) to
   * inject as a hidden turn. How the avatar reacts to it lives in the server's
   * system prompt, not here.
   */
  signal?: string;
}

function isCheck(value: unknown): value is PerceptionCheckInfo {
  const c = value as PerceptionCheckInfo | null;
  return (
    !!c &&
    typeof c.name === "string" &&
    typeof c.intervalMs === "number" &&
    c.intervalMs > 0 &&
    typeof c.consecutive === "number" &&
    typeof c.frameMaxPx === "number" &&
    typeof c.frameQuality === "number"
  );
}

/**
 * Checks the server wants polled. Returns [] on any failure — perception is an
 * enhancement, so a server without it (or an unreachable one) just means the
 * camera behaves as it always did.
 */
export async function fetchPerceptionChecks(): Promise<PerceptionCheckInfo[]> {
  try {
    const res = await fetch("/api/perception");
    if (!res.ok) throw new Error(`${res.status}`);
    const json: unknown = await res.json();
    return Array.isArray(json) ? json.filter(isCheck) : [];
  } catch (e) {
    console.warn("perception checks unavailable", e);
    return [];
  }
}

/** Run one check against a frame. null when the tick produced no verdict. */
export async function runPerceptionCheck(
  name: string,
  frame: Blob,
): Promise<PerceptionVerdict | null> {
  try {
    const fd = new FormData();
    fd.append("image", frame, "frame.jpg");
    const res = await fetch(`/api/perception/${encodeURIComponent(name)}`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const verdict = json as PerceptionVerdict | null;
    if (!verdict || typeof verdict.label !== "string") return null;
    return verdict;
  } catch {
    // Polling is best-effort: a failed tick is simply skipped.
    return null;
  }
}
