import type { IdleCheck } from "./types.ts";

/** How long the user may go without responding before the avatar checks in. */
export const IDLE_AFTER_MS = 60_000;

/**
 * Has the user gone quiet?
 *
 * Unlike the camera checks this needs no sensor and no model: the browser
 * keeps the clock — time since the avatar last finished a turn, or since the
 * user last typed, not counting while the avatar is still talking — and once
 * it passes `afterMs` it asks `POST /api/perception/idle` (no image) for this
 * check's signal and injects it like any other nudge. So the wording still
 * lives here, the guidance still goes into the system prompt, and the shared
 * arm still applies: the avatar asks once, then waits for an answer.
 */
export function createIdleCheck(): IdleCheck {
  const minutes = IDLE_AFTER_MS / 60_000;
  return {
    name: "idle",
    label: "장시간 무응답 인식",
    description: `${minutes}분 넘게 아무 응답이 없는지 확인합니다.`,
    // Nothing to switch on: the browser's own clock is the sensor.
    requires: [],
    trigger: { kind: "idle", afterMs: IDLE_AFTER_MS },
    signal: `(perception: 사용자가 ${minutes}분 넘게 아무 응답이 없습니다)`,
    guidance:
      "- 사용자가 한동안 응답이 없다는 알림이 오면: 지금 뭘 하고 있는지, 문제는 없는지 가볍게 묻는 짧은 한두 문장만 말하라. 재촉하거나 나무라지 말고, 시간·타이머·알림은 언급하지 말고, 되묻거나 무슨 뜻이냐고 하지 마라.",
  };
}
