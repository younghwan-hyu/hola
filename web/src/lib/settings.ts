/**
 * Local UI preferences, kept in localStorage exactly like the avatar pick in
 * ./avatars.ts. Nothing here is sent to the server.
 */

/** How the chat bubbles are presented. */
export type BubbleMode = "inline" | "separate";

const STORAGE_KEY = "hola.bubbleMode";

export const BUBBLE_MODES: {
  id: BubbleMode;
  label: string;
  hint: string;
}[] = [
  {
    id: "inline",
    label: "인라인",
    hint: "3D 화면 위에 최근 대화만 겹쳐 보여줍니다.",
  },
  {
    id: "separate",
    label: "분리",
    hint: "3D 화면 아래 창에 대화가 쌓이고, 스크롤해서 다시 볼 수 있습니다.",
  },
];

/** The stored mode, or `inline` when nothing (usable) is stored. */
export function loadBubbleMode(): BubbleMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "inline" || stored === "separate") return stored;
  } catch {
    // storage unavailable (e.g. Safari private mode) — fall through
  }
  return "inline";
}

export function storeBubbleMode(mode: BubbleMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // storage unavailable — the pick just won't survive a reload
  }
}

// ── 배경 (scene backdrop) ────────────────────────────────────────────────────

/** Which backdrop the avatar stands in. Built in ./backgrounds.ts. */
export type Background = "classroom" | "none";

const BACKGROUND_KEY = "hola.background";

export const BACKGROUNDS: {
  id: Background;
  label: string;
  hint: string;
}[] = [
  {
    id: "classroom",
    label: "강의실",
    hint: "화이트보드와 프로젝터 스크린, 긴 책상이 있는 대학 강의실입니다.",
  },
  {
    id: "none",
    label: "없음",
    hint: "배경 없이 어두운 화면에 아바타만 보여줍니다.",
  },
];

/** The stored backdrop, or `classroom` when nothing (usable) is stored. */
export function loadBackground(): Background {
  try {
    const stored = window.localStorage.getItem(BACKGROUND_KEY);
    const known = BACKGROUNDS.find((b) => b.id === stored);
    if (known) return known.id;
  } catch {
    // storage unavailable — fall through
  }
  return "classroom";
}

export function storeBackground(id: Background): void {
  try {
    window.localStorage.setItem(BACKGROUND_KEY, id);
  } catch {
    // storage unavailable — the pick just won't survive a reload
  }
}

// ── 상황 인지 (perception) on/off ───────────────────────────────────────────
//
// Stored as the set of check names the user switched OFF, so anything the
// server advertises that isn't listed — including a check added later — is on
// by default without a migration.
const PERCEPTION_KEY = "hola.perceptionDisabled";

/** Names of the perception checks the user switched off; empty when none. */
export function loadDisabledPerception(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PERCEPTION_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(
          parsed.filter((v): v is string => typeof v === "string"),
        );
      }
    }
  } catch {
    // storage unavailable or corrupt — every check stays on
  }
  return new Set();
}

export function storeDisabledPerception(disabled: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(PERCEPTION_KEY, JSON.stringify([...disabled]));
  } catch {
    // storage unavailable — the choice just won't survive a reload
  }
}
