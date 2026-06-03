import { Frown, Hand, Smile, Sun, type LucideIcon } from "lucide-react";

/** One-shot gestures the avatar can play. */
export type AvatarGesture =
  | "expression_happy"
  | "expression_sad"
  | "action_wave"
  | "show_sunny";

export interface GestureDef {
  /** Id passed to AvatarHandle.playGesture(). */
  id: AvatarGesture;
  /** Korean label shown in the gesture menu. */
  label: string;
  /** Icon shown next to the label in the menu. */
  icon: LucideIcon;
  /** Total play time (s): pop in → hold → fade out. Also when it auto-clears. */
  durationSeconds: number;
}

/**
 * Single source of truth for the avatar's gestures: ids, menu labels/icons and
 * timing. The gesture menu (App.tsx) renders from this list and Avatar.tsx reads
 * the durations. To add a gesture: add an entry here, then handle its id in
 * Avatar.tsx's render loop.
 */
export const GESTURES: GestureDef[] = [
  { id: "expression_happy", label: "기쁜 표정", icon: Smile, durationSeconds: 2.6 },
  { id: "expression_sad", label: "슬픈 표정", icon: Frown, durationSeconds: 2.6 },
  { id: "action_wave", label: "손 흔들기", icon: Hand, durationSeconds: 1.6 },
  { id: "show_sunny", label: "맑은 날씨", icon: Sun, durationSeconds: 4.5 },
];

/** id → duration lookup, derived from GESTURES, for the render loop. */
export const GESTURE_DURATION = Object.fromEntries(
  GESTURES.map((g) => [g.id, g.durationSeconds]),
) as Record<AvatarGesture, number>;
