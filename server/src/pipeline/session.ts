import { randomUUID } from "node:crypto";

import type { SseTarget } from "../util/sse.ts";

export type ChatEvent =
  | { type: "stt"; text: string; source: "audio" | "text" }
  | { type: "ai_delta"; text: string }
  | { type: "ai_complete"; text: string }
  | { type: "tts_start"; sentenceIdx: number; text: string }
  | { type: "tts_chunk"; sentenceIdx: number; audio: string } // base64
  | { type: "tts_end"; sentenceIdx: number }
  | {
      type: "timing";
      phase: "stt" | "ai_ttft" | "ai_total" | "tts_first_chunk" | "tts_total";
      ms: number;
    }
  | { type: "done" }
  | { type: "error"; message: string };

interface Subscriber {
  target: SseTarget;
}

/**
 * One pipeline invocation. Events produced by the pipeline are buffered until
 * the client opens the SSE connection, then live-streamed.
 */
export class Session {
  readonly id: string;
  private readonly events: ChatEvent[] = [];
  private subscriber: Subscriber | undefined;
  private closed = false;

  constructor() {
    this.id = randomUUID();
  }

  emit(event: ChatEvent): void {
    if (this.closed && this.subscriber === undefined) return;
    if (this.subscriber) {
      this.subscriber.target.write(event.type, event);
    } else {
      this.events.push(event);
    }
  }

  subscribe(target: SseTarget): void {
    if (this.subscriber) {
      throw new Error(`session ${this.id} already subscribed`);
    }
    this.subscriber = { target };
    for (const ev of this.events) {
      target.write(ev.type, ev);
    }
    this.events.length = 0;
    if (this.closed) {
      target.end();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.subscriber) {
      this.subscriber.target.end();
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

/** In-memory map of session id → Session. */
export class SessionRegistry {
  private readonly map = new Map<string, Session>();
  /** Discard sessions that no client ever subscribed to. */
  private readonly ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  create(): Session {
    const session = new Session();
    this.map.set(session.id, session);
    setTimeout(() => {
      this.map.delete(session.id);
    }, this.ttlMs).unref();
    return session;
  }

  take(id: string): Session | undefined {
    const s = this.map.get(id);
    if (s) this.map.delete(id);
    return s;
  }
}
