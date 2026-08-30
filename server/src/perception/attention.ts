import type { PerceptionCheck } from "./types.ts";

/**
 * Is the user looking at the screen, or at something else?
 *
 * Runs on the same camera frames as `presence` but asks a different question:
 * the face IS in frame, yet the gaze has left the screen — turned to the side,
 * down at a phone / book / desk, or over the shoulder. Looking at the monitor
 * itself is `attentive` even though that puts the eyes slightly below a webcam
 * mounted on top of it. An empty frame is deliberately `attentive` (the inert
 * label) — that case belongs to `presence`, and the two must never both want
 * to speak. Only one check gets to nudge per episode anyway (the client shares
 * a single arm across every check — see `perceptionArmed` in web/src/App.tsx),
 * but keeping the labels disjoint means the nudge that does happen is always
 * the fitting one.
 */
export function createAttentionCheck(): PerceptionCheck {
  return {
    name: "attention",
    label: "집중도 인식",
    description: "집중하지 않고 다른 것을 보고 있는지 확인합니다.",
    requires: ["camera"],
    trigger: {
      kind: "poll",
      // Slower than presence: looking away is only worth mentioning once it
      // lasts, and this shares the polling budget with the presence check.
      intervalMs: 4000,
      // "Looking elsewhere" is broad — a glance at the keyboard or a second
      // monitor qualifies — so require two frames in a row (~8s) before
      // speaking. Drop to 1 to react to the first frame.
      consecutive: 2,
    },
    // Reading gaze direction needs more pixels than spotting a person, so
    // this frame is larger than presence's. Still under the 512px
    // that OpenAI's flat-rate "low detail" mode downsamples to, so on OpenAI
    // it bills exactly the same as the small one.
    frame: { maxPx: 448, quality: 0.6 },
    prompt:
      '이 사진 속 사람이 화면이나 카메라 쪽을 보고 있으면 "attentive", 화면이 아닌 다른 곳을 보고 있으면 "distracted"라고만 답하라. 고개나 시선을 옆, 아래, 뒤로 돌려 화면 밖의 것을 보고 있거나, 손에 든 휴대폰, 책, 종이 같은 것을 들여다보고 있으면 "distracted"다. 얼굴이 카메라 쪽을 향해 있으면 시선이 카메라보다 조금 아래의 모니터를 향해도 "attentive"다. 사람이 없거나 얼굴이 보이지 않으면 "attentive"다. 다른 말은 절대 하지 마라.',
    // "attentive" first: an answer we can't parse must not trigger the avatar.
    labels: ["attentive", "distracted"],
    triggers: {
      distracted: "(perception: 사용자가 화면이 아닌 다른 곳을 보고 있습니다)",
    },
    guidance:
      "- 사용자가 화면이 아닌 다른 곳을 보고 있다는 알림이 오면: 무엇을 보고 있는지 가볍게 묻는 짧은 한 문장만 말하라. 나무라지 말고, 카메라·화면·이미지는 언급하지 말고, 되묻거나 무슨 뜻이냐고 하지 마라.",
    maxTokens: 8,
  };
}
