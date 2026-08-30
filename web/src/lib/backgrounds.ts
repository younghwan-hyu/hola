import type * as THREE from "three";

import { createClassroom } from "./classroom";
import type { Background } from "./settings";

/**
 * Build the backdrop for a Background id. The option list and the stored
 * choice live in ./settings.ts; this is the only place that knows how each
 * one is made. Returns null for "none" — the renderer is transparent, so the
 * page's CSS gradient shows through.
 *
 * To add a backdrop: write a factory returning a THREE.Group (see
 * ./classroom.ts for the frame of reference), add a case here and an entry to
 * BACKGROUNDS in ./settings.ts. Avatar.tsx and the settings modal are generic
 * over the list.
 */
export function createBackground(id: Background): THREE.Group | null {
  switch (id) {
    case "classroom":
      return createClassroom();
    case "none":
      return null;
  }
}
