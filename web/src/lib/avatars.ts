/**
 * Avatar list, resolved at RUNTIME from `public/avatars.json` — a plain array of
 * `.vrm` paths:
 *
 *   ["/girl.vrm", "/Sakurada_Fumiriya.vrm"]
 *
 * The app fetches it on mount, so dropping a model in `public/` and adding its
 * path to the manifest shows up on a page refresh — no rebuild, no restart.
 * The first entry is the default and the filename is the label in the picker.
 */

/** Shipped with the app; used when the manifest is missing or unusable. */
const BUILTIN = "/girl.vrm";

/** Served from public/, so it honours a non-root base path like Avatar's sun.glb. */
const MANIFEST_URL = `${import.meta.env.BASE_URL}avatars.json`;

const STORAGE_KEY = "hola.avatarUrl";

/**
 * Read the manifest. Never rejects: a missing/malformed manifest falls back to
 * the built-in model so the avatar always renders.
 */
export async function fetchAvatars(): Promise<string[]> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`${res.status}`);
    const json: unknown = await res.json();
    if (!Array.isArray(json)) throw new Error("manifest is not an array");
    const urls = [
      ...new Set(
        json
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    ];
    if (urls.length === 0) throw new Error("manifest is empty");
    return urls;
  } catch (e) {
    console.warn(`avatars.json unavailable, using ${BUILTIN}`, e);
    return [BUILTIN];
  }
}

/** Display name for a model: its filename without the `.vrm` extension. */
export function avatarLabel(url: string): string {
  const last = url.split("/").pop() ?? url;
  return last.replace(/\.vrm$/i, "") || url;
}

/**
 * Which model to show for a freshly-loaded manifest: the one the user picked
 * last, if it is still listed, otherwise the first entry. Storage access is
 * guarded — Safari private mode throws on localStorage.
 */
export function pickInitialAvatar(avatars: string[]): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && avatars.includes(stored)) return stored;
  } catch {
    // storage unavailable — fall through to the first entry
  }
  return avatars[0] ?? BUILTIN;
}

export function storeAvatar(url: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // storage unavailable — the pick just won't survive a reload
  }
}
