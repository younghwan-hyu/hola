import type { AiProvider } from "../ai/index.ts";
import { createPresenceCheck } from "./presence.ts";
import type {
  PerceptionCheck,
  PerceptionInput,
  PerceptionVerdict,
} from "./types.ts";

/**
 * The perception checks the browser polls while the camera is on.
 *
 * To add one: write `./<name>.ts` exporting a factory that returns a
 * {@link PerceptionCheck}, then list it here. Nothing else needs to change —
 * the route serves it and the client discovers it from `GET /api/perception`.
 */
export function createPerceptionChecks(): PerceptionCheck[] {
  return [createPresenceCheck()];
}

/** Explains the `(perception: ...)` signals before the per-check rules. */
const PERCEPTION_PREAMBLE = `대화 도중 \`(perception: ...)\` 로 시작하는 메시지가 올 수 있다. 이것은 사용자가 한 말이 아니라 카메라·센서가 감지한 상태 알림이다. 괄호 안 문장을 그대로 읽거나 언급하지 말고, 알림 자체에 대해 되묻지도 말고, 아래 규칙에 따라 사용자에게 건네는 자연스러운 말 한마디로만 반응하라.`;

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
function toLabel(check: PerceptionCheck, answer: string): string | undefined {
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
  check: PerceptionCheck,
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

export type {
  PerceptionCheck,
  PerceptionCheckInfo,
  PerceptionInput,
  PerceptionVerdict,
} from "./types.ts";
