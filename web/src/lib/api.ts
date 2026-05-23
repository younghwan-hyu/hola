export interface HealthInfo {
  ok: boolean;
  stt: { provider: string; model: string };
  ai: { provider: string; model: string };
  tts: { provider: string; voice: string };
}

export interface ChatHandle {
  sessionId: string;
  config: {
    stt: { provider: string; model: string };
    ai: { provider: string; model: string };
    tts: { provider: string; voice: string };
    audio: {
      encoding: "PCM" | "OGG_OPUS";
      sampleRateHertz: number;
      channels: number;
      bitsPerSample: number;
    };
  };
}

export async function fetchHealth(): Promise<HealthInfo> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`GET /api/health failed: ${res.status}`);
  return res.json();
}

export async function startChat(input: {
  text?: string;
  audio?: Blob;
}): Promise<ChatHandle> {
  const fd = new FormData();
  if (input.text !== undefined) fd.append("text", input.text);
  if (input.audio) {
    const ext = input.audio.type.includes("ogg") ? "ogg" : "webm";
    fd.append("audio", input.audio, `audio.${ext}`);
  }
  const res = await fetch("/api/chat", { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(
      `POST /api/chat failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  const json = await res.json();
  return { sessionId: json.session_id, config: json.config };
}

export type ChatEvent =
  | { type: "stt"; text: string; source: "audio" | "text" }
  | { type: "ai_delta"; text: string }
  | { type: "ai_complete"; text: string }
  | { type: "tts_start"; sentenceIdx: number; text: string }
  | { type: "tts_chunk"; sentenceIdx: number; audio: string }
  | { type: "tts_end"; sentenceIdx: number }
  | {
      type: "timing";
      phase: "stt" | "ai_ttft" | "ai_total" | "tts_first_chunk" | "tts_total";
      ms: number;
    }
  | { type: "done" }
  | { type: "error"; message: string };

const EVENT_TYPES = [
  "stt",
  "ai_delta",
  "ai_complete",
  "tts_start",
  "tts_chunk",
  "tts_end",
  "timing",
  "done",
  "error",
] as const;

/** Opens an SSE connection for the given session and dispatches ChatEvents. */
export function subscribeChat(
  sessionId: string,
  onEvent: (ev: ChatEvent) => void,
  onTransportError?: (e: Event) => void,
): () => void {
  const es = new EventSource(`/api/chat/${sessionId}`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    es.close();
  };

  for (const type of EVENT_TYPES) {
    es.addEventListener(type, (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        onEvent(data as ChatEvent);
        if (data.type === "done" || data.type === "error") close();
      } catch (err) {
        console.error("failed to parse SSE event", type, err);
      }
    });
  }
  es.addEventListener("error", (e) => {
    // EventSource fires "error" both on transport errors and on close.
    // If the server already sent "done"/"error", we're already closed.
    if (!closed) onTransportError?.(e);
  });
  return close;
}
