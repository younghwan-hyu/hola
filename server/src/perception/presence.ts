import type { PerceptionCheck } from "./types.ts";

/**
 * Is the user's FACE still in frame?
 *
 * Stricter than "is anybody in frame" — a torso at the edge of the shot with
 * the head cropped out counts as gone — but no stricter than that: the face
 * only has to be visible, not looking at the camera. Glancing away, a partly
 * covered face or a dim frame are all still `present`; nudging the user for
 * those reads as nagging.
 *
 * Polled while the camera is on. It only speaks once per disappearance — the
 * client keeps the trigger disarmed until the user actually sends a turn (see
 * `perceptionArmed` in web/src/App.tsx), so reappearing alone doesn't re-arm it.
 */
export function createPresenceCheck(): PerceptionCheck {
  return {
    name: "presence",
    label: "존재 인식",
    description: "얼굴이 카메라에서 사라지면 어디 갔는지 묻습니다.",
    requires: ["camera"],
    trigger: {
      kind: "poll",
      intervalMs: 3000,
      // Speak up on the first frame without a face. Note a face-level check
      // does flicker on ordinary moments — a glance down at the keyboard, a
      // turn to a second monitor — so raise this to 2 (~6s) if the nudges feel
      // trigger-happy.
      consecutive: 1,
    },
    // A face is still easy to spot at low resolution, and OpenAI bills a "low
    // detail" image at a flat token rate — keep the polling frame small.
    frame: { maxPx: 256, quality: 0.5 },
    prompt:
      '이 사진에 사람의 얼굴이 보이면 "present", 보이지 않으면 "absent"라고만 답하라. 얼굴이 화면에 나오기만 하면 다른 곳을 보고 있든, 옆얼굴이든, 일부가 가려졌든, 어둡든 상관없이 "present"다. 아무도 없거나, 몸이나 손만 나오고 얼굴은 화면 밖으로 벗어났거나, 뒤통수만 보여서 얼굴을 볼 수 없을 때만 "absent"다. 다른 말은 절대 하지 마라.',
    // "present" first: an answer we can't parse must not trigger the avatar.
    labels: ["present", "absent"],
    // The signal is a plain-Korean sensor reading, not a code: a terse token
    // like `presence=absent` gets answered with "무슨 뜻인지 모르겠습니다".
    // What to DO about it stays in the system prompt (`guidance`).
    triggers: { absent: "(perception: 사용자가 카메라 화면에서 사라졌습니다)" },
    guidance:
      "- 사용자가 카메라 화면에서 사라졌다는 알림이 오면: 사용자를 부르며 어디 갔는지 묻는 짧은 한 문장만 말하라. 카메라·화면·이미지는 언급하지 말고, 되묻거나 무슨 뜻이냐고 하지 마라.",
    maxTokens: 8,
  };
}
