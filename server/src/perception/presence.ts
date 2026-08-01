import type { PerceptionCheck } from "./types.ts";

/**
 * Is the user still in front of the camera?
 *
 * Polled while the camera is on; the first frame with nobody in it makes the
 * avatar check in on them. It only speaks once per disappearance — the client
 * re-arms the trigger when `present` comes back.
 */
export function createPresenceCheck(): PerceptionCheck {
  return {
    name: "presence",
    intervalMs: 3000,
    consecutive: 1, // speak up on the first frame with nobody in it
    // A person is easy to spot at low resolution, and OpenAI bills a "low
    // detail" image at a flat token rate — keep the polling frame small.
    frameMaxPx: 256,
    frameQuality: 0.5,
    prompt:
      '이 사진에 사람이 일부라도 (얼굴, 몸, 손 등) 보이면 "present", 아무도 없으면 "absent"라고만 답하라. 다른 말은 절대 하지 마라.',
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
