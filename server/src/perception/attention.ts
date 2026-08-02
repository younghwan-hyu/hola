import type { PerceptionCheck } from "./types.ts";

/**
 * Is the user looking at the avatar, or at something in their hands?
 *
 * Runs on the same camera frames as `presence` but asks a different question:
 * the face IS in frame, yet the user is reading a phone / tablet / book. An
 * empty frame is deliberately `attentive` (the inert label) — that case belongs
 * to `presence`, and the two must never both want to speak. Only one check gets
 * to nudge per episode anyway (the client shares a single arm across every
 * check — see `perceptionArmed` in web/src/App.tsx), but keeping the labels
 * disjoint means the nudge that does happen is always the fitting one.
 */
export function createAttentionCheck(): PerceptionCheck {
  return {
    name: "attention",
    // Slower than presence: looking away is only worth mentioning once it
    // lasts, and this shares the polling budget with the presence check.
    intervalMs: 4000,
    // Ask as soon as one frame catches them looking. Raise to 2 (~10s) if you'd
    // rather not interrupt over a glance at a notification.
    consecutive: 1,
    // Spotting a phone in someone's hands needs more pixels than spotting a
    // person, so this frame is larger than presence's. Still under the 512px
    // that OpenAI's flat-rate "low detail" mode downsamples to, so on OpenAI
    // it bills exactly the same as the small one.
    frameMaxPx: 448,
    frameQuality: 0.6,
    prompt:
      '이 사진 속 사람이 손에 든 휴대폰, 태블릿, 책, 종이 같은 물건을 내려다보거나 들여다보고 있으면 "distracted", 그렇지 않으면 "attentive"라고만 답하라. 사람이 없거나 얼굴이 보이지 않으면 "attentive"다. 물건을 들고만 있고 시선이 그쪽을 향하지 않으면 "attentive"다. 다른 말은 절대 하지 마라.',
    // "attentive" first: an answer we can't parse must not trigger the avatar.
    labels: ["attentive", "distracted"],
    triggers: {
      distracted:
        "(perception: 사용자가 손에 든 휴대폰이나 다른 물건을 들여다보고 있습니다)",
    },
    guidance:
      "- 사용자가 손에 든 물건을 들여다보고 있다는 알림이 오면: 무엇을 보고 있는지 가볍게 묻는 짧은 한 문장만 말하라. 나무라지 말고, 카메라·화면·이미지는 언급하지 말고, 되묻거나 무슨 뜻이냐고 하지 마라.",
    maxTokens: 8,
  };
}
