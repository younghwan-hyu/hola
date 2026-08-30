import type { AiProvider } from "../ai/index.ts";
import { createAttentionCheck } from "./attention.ts";
import { createExpressionCheck } from "./expression.ts";
import { createIdleCheck } from "./idle.ts";
import { createPresenceCheck } from "./presence.ts";
import { createVoiceCheck } from "./voice.ts";
import type {
  CameraCheck,
  PerceptionCheck,
  PerceptionInput,
  PerceptionVerdict,
} from "./types.ts";

/**
 * The perception checks the browser runs: camera checks polled while the
 * camera is on, the voice check on every spoken turn, the idle timer always.
 *
 * To add one: write `./<name>.ts` exporting a factory that returns a
 * {@link PerceptionCheck}, then list it here. Nothing else needs to change —
 * the route serves it and the client discovers it from `GET /api/perception`.
 *
 * Checks run independently, but the avatar only ever speaks ONCE per episode:
 * the client arms every registered check together and disarms them all as soon
 * as one nudges, so two checks can never stack two remarks on top of each other
 * (see `perceptionArmed` in web/src/App.tsx). Design a new check's labels to be
 * disjoint from the existing ones anyway — whichever one wins the race should
 * be the one that actually fits the frame.
 */
export function createPerceptionChecks(): PerceptionCheck[] {
  return [
    createPresenceCheck(),
    createAttentionCheck(),
    createExpressionCheck(),
    createVoiceCheck(),
    createIdleCheck(),
  ];
}

/**
 * Explains the `(perception: ...)` signals before the per-check rules.
 *
 * The trailing sentences cover the turn AFTER a nudge — the user answering
 * "어디 가셨어요?" is a throwaway exchange, not a topic, so the avatar
 * acknowledges it and gets out of the way. Cross-cutting, so it lives here
 * rather than in any one check's guidance.
 */
const PERCEPTION_PREAMBLE = `대화 도중 \`(perception: ...)\` 로 시작하는 메시지가 올 수 있다. 이것은 사용자가 한 말이 아니라 카메라·센서가 감지한 상태 알림이다. 괄호 안 문장을 그대로 읽거나 언급하지 말고, 알림 자체에 대해 되묻지도 말고, 아래 규칙에 따라 사용자에게 건네는 자연스러운 말 한마디로만 반응하라. 그렇게 말을 건 뒤 사용자가 대답하면, 사용자가 말한 내용을 짚어서 알겠다는 짧은 한 문장으로만 반응하고 끝내라. 캐묻거나 훈수 두지 말고, 도와줄까 묻거나 하던 얘기를 다시 꺼내는 등 뒤에 다른 말을 덧붙이지 마라. 다만 대답에 질문이나 다른 용건이 섞여 있으면 그 부분은 평소대로 답하라.
알림이 사용자 메시지의 끝에 붙어 오는 경우도 있다(사용자의 말 다음 줄에 \`(perception: ...)\`). 그것은 그 말을 하는 사용자의 목소리·상태에 대한 알림이다. 그때는 별도의 말을 걸지 말고 사용자의 메시지에 평소대로 답하되, 아래 규칙에 따라 답하는 방식만 조절하라. 알림이나 사용자의 말투·목소리는 절대 언급하지 마라.`;

/**
 * The system prompt plus every registered check's guidance.
 *
 * Behaviour for a signal has to live in the system prompt — an instruction
 * smuggled into the injected user turn is unreliable, the model tends to ignore
 * it or read it back. Composing it from the checks keeps "one check = one file".
 */
export function withPerceptionGuidance(
  base: string,
  checks: PerceptionCheck[],
): string {
  const rules = checks.map((c) => c.guidance.trim()).filter(Boolean);
  if (rules.length === 0) return base;
  return `${base}\n\n${PERCEPTION_PREAMBLE}\n${rules.join("\n")}`;
}

/**
 * Map the model's free-form answer onto one of the check's labels. Longest
 * label first so a label that is a prefix of another can't win by accident.
 */
function toLabel(check: CameraCheck, answer: string): string | undefined {
  const normalized = answer.toLowerCase();
  return [...check.labels]
    .sort((a, b) => b.length - a.length)
    .find((label) => normalized.includes(label.toLowerCase()));
}

/**
 * Run one check against a frame. This never touches the conversation session:
 * it is a single stateless, tool-less, non-streaming call capped to a few
 * output tokens, so polling neither pollutes the history nor is billed for it.
 */
export async function runPerceptionCheck(
  check: CameraCheck,
  input: PerceptionInput,
  ai: AiProvider,
): Promise<PerceptionVerdict> {
  const answer = await ai.classify({
    prompt: check.prompt,
    image: input.image,
    maxTokens: check.maxTokens,
  });

  const matched = toLabel(check, answer);
  if (!matched) {
    console.warn(
      `[hola] perception ${check.name}: unrecognized answer ${JSON.stringify(answer)}`,
    );
  }
  // Fall back to the inert label so a bad answer can never make the avatar talk.
  const label = matched ?? check.labels[0] ?? "";

  const signal = check.triggers[label];
  if (signal) console.log(`[hola] perception ${check.name} -> ${label}`);
  return signal ? { label, signal } : { label };
}

export { isCameraCheck, isIdleCheck, isVoiceCheck } from "./types.ts";
export type {
  CameraCheck,
  IdleCheck,
  PerceptionCheck,
  PerceptionCheckInfo,
  PerceptionInput,
  PerceptionVerdict,
  VoiceAnalysisInput,
  VoiceCheck,
  VoiceFeatures,
} from "./types.ts";
