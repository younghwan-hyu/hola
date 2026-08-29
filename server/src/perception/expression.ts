import type { PerceptionCheck } from "./types.ts";

/**
 * Does the user's face look troubled — gloomy or puzzled — as if they didn't
 * follow what was just said?
 *
 * Same frames as `presence` / `attention`, a different question: the face IS
 * in frame and IS on the avatar, but it's frowning, sulking, worried or
 * visibly confused (furrowed brow, tilted head, pursed lips). A calm, blank,
 * bright or concentrating face is `fine` — there is nothing to say about it —
 * and so is a frame with no face, or one too small to read: those belong to
 * `presence`. The checks' labels are kept disjoint so whichever one nudges
 * first fits the frame (only one gets to per episode; see `perceptionArmed`
 * in web/src/App.tsx).
 *
 * Expressions flicker, so this check waits for TWO consecutive troubled
 * verdicts (~10s at the 5s interval) before speaking: a passing frown is not
 * worth interrupting over, a look that lasts is.
 */
export function createExpressionCheck(): PerceptionCheck {
  return {
    name: "expression",
    label: "표정 인식",
    description:
      "표정이 어둡거나 아리송해 보이면 이해가 잘 안 되는지, 어려운지 묻습니다. 잠깐 스치는 표정은 넘기고 10초쯤 이어질 때만 묻습니다.",
    requires: ["camera"],
    trigger: {
      kind: "poll",
      // Expressions change slowly compared with someone leaving the frame, and
      // this shares the polling budget with the other two checks.
      intervalMs: 5000,
      // Two troubled frames in a row (~10s) before asking: a momentary frown or
      // a glance down at notes reads as "troubled" too, and asking about it
      // would be noise. Lower to 1 to react at once.
      consecutive: 2,
    },
    // Reading an expression needs the face at a usable size: the biggest frame
    // OpenAI still bills at the flat "low detail" rate (it downsamples to 512px).
    frame: { maxPx: 512, quality: 0.7 },
    prompt:
      '이 사진 속 사람의 표정을 보고 답하라. 미간을 찌푸리거나, 입을 삐죽이거나, 고개를 갸웃하거나, 시무룩하거나, 걱정스럽거나, 멍하니 헷갈려하는 것처럼 표정이 어둡거나 아리송하면 "troubled", 무표정·평온·밝음·집중한 표정처럼 별다른 문제가 없어 보이면 "fine"이라고만 답하라. 사람이 없거나, 얼굴이 보이지 않거나, 얼굴이 너무 작거나 가려져서 표정을 알 수 없으면 "fine"이다. 다른 말은 절대 하지 마라.',
    // "fine" first: an answer we can't parse must not trigger the avatar.
    labels: ["fine", "troubled"],
    triggers: {
      troubled: "(perception: 사용자의 표정이 어둡거나 아리송해 보입니다)",
    },
    // The follow-up rule here deliberately overrides the preamble's "acknowledge
    // in one sentence and stop": unlike "where did you go?", "was that hard?"
    // is an offer to help, so a "yes" has to be answered with help.
    guidance:
      "- 사용자의 표정이 어둡거나 아리송해 보인다는 알림이 오면: 방금 이야기한 내용이 잘 이해되지 않았는지, 어려운 부분이 있는지 부드럽게 묻는 짧은 한 문장만 말하라 (예: \"혹시 방금 설명이 잘 이해되지 않으셨어요? 어려운 부분이 있으면 말씀해 주세요.\"). 직전에 설명한 내용이 없더라도 \"무엇을 도와드릴까요?\" 같은 일반적인 인사로 대신하지 말고, 어렵거나 헷갈리는 부분이 있는지를 물어라. 카메라·표정·이미지는 언급하지 말고, 되묻거나 무슨 뜻이냐고 하지 마라. 이 물음에 사용자가 어렵다거나 이해가 안 된다고 답하면, 위의 '짧은 한 문장으로만 반응하고 끝내라'는 규칙 대신 평소대로 어느 부분이 어려운지 확인하거나 더 쉽게 다시 설명하라. 괜찮다고 답하면 짧게 알겠다고만 하고 끝내라.",
    maxTokens: 8,
  };
}
