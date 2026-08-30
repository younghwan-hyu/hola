/**
 * Perception checks — the server's "look at the camera and tell me X" probes.
 *
 * The browser doesn't know what any individual check means: it fetches the list
 * from the server, polls each one the user hasn't switched off (the 상황 인지
 * modal in App.tsx; the choice persists via lib/settings.ts) on its own interval
 * while the camera is on, and if a verdict comes back carrying a `signal`, hands
 * that text to the normal chat pipeline so the avatar says something. Adding a
 * check server-side needs no change here — it shows up in the modal with the
 * label/description the server sends. See `server/src/perception/`.
 */

/**
 * How a check is driven. Polled checks (camera) tick on a timer; turn checks
 * run once per user turn of the given input — today, every spoken turn — and
 * ride along with that turn (see `send` in App.tsx) instead of polling.
 */
export type PerceptionTrigger =
  | {
      kind: "poll";
      /** How often to sample while the check can run (a tick is skipped only if this check's previous request is still pending). */
      intervalMs: number;
      /** Consecutive triggering verdicts required before acting (1 = immediately). */
      consecutive: number;
    }
  | { kind: "turn"; input: "voice" };

/** Long edge (px) / JPEG quality of the camera frame to send. */
export interface PerceptionFrameSpec {
  maxPx: number;
  quality: number;
}

export interface PerceptionCheckInfo {
  name: string;
  /** Name and one-line description shown in the 상황 인지 on/off modal. */
  label: string;
  description: string;
  /**
   * What the browser must provide for the check to run. "camera" is the only
   * requirement this client knows how to satisfy; anything else the server may
   * add later still gets a badge but counts as unmet, so the check never runs.
   */
  requires: string[];
  trigger: PerceptionTrigger;
  /**
   * Set when the check compares against the user's own baseline instead of an
   * absolute rule — shown as an extra "상대적 측정" badge.
   */
  relative?: boolean;
  /** Present for camera checks: how to capture the frame that is sent. */
  frame?: PerceptionFrameSpec;
}

/**
 * The one badge shown next to a check's name: how it is driven, folded together
 * with what it needs ("카메라 폴링" rather than "카메라 필요" + "3초 폴링" —
 * the interval is deliberately not shown). Turn-driven checks read
 * "말할 때마다".
 */
export function checkBadge(check: PerceptionCheckInfo): string {
  if (check.trigger.kind === "turn") return "말할 때마다";
  return check.requires.includes("camera") ? "카메라 폴링" : "폴링";
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
  const c = value as Record<string, unknown> | null;
  if (
    !c ||
    typeof c.name !== "string" ||
    typeof c.label !== "string" ||
    typeof c.description !== "string"
  )
    return false;
  const requires = c.requires;
  if (!Array.isArray(requires) || !requires.every((r) => typeof r === "string"))
    return false;
  const t = c.trigger as Record<string, unknown> | null | undefined;
  if (!t) return false;
  if (t.kind === "poll") {
    if (
      typeof t.intervalMs !== "number" ||
      t.intervalMs <= 0 ||
      typeof t.consecutive !== "number"
    )
      return false;
  } else if (t.kind === "turn") {
    if (t.input !== "voice") return false;
  } else {
    return false;
  }
  // A camera check without a frame spec couldn't be captured for.
  const f = c.frame as Record<string, unknown> | null | undefined;
  const hasFrame = !!f && typeof f.maxPx === "number" && typeof f.quality === "number";
  if (requires.includes("camera") && !hasFrame) return false;
  return true;
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

/**
 * Cap on one classify round-trip. A check skips its ticks while its previous
 * request is still pending, so without this a single hung request would freeze
 * that check for as long as the server's own (minutes-long) timeout. A classify
 * normally answers in 1–3s; past this it's just a missed tick.
 */
const PERCEPTION_TIMEOUT_MS = 8000;

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
      signal: AbortSignal.timeout(PERCEPTION_TIMEOUT_MS),
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
