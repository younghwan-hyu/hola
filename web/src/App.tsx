import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Loader2, Send } from "lucide-react";

import { Recorder } from "@/components/Recorder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchHealth,
  startChat,
  subscribeChat,
  type ChatEvent,
  type HealthInfo,
} from "@/lib/api";
import { base64ToArrayBuffer, StreamingPcmPlayer } from "@/lib/audio";

interface Turn {
  id: string;
  user: string;
  userSource: "audio" | "text" | "audio-pending";
  ai: string;
  status: "running" | "done" | "error";
  errorMessage?: string;
  timing: {
    sttClientMs?: number; // user-perceived: request sent -> transcript received
    sttMs?: number; // server-side recognize() only
    aiTtftMs?: number;
    aiTotalMs?: number;
    ttsFirstChunkMs?: number;
    ttsTotalMs?: number;
  };
}

const newId = () => Math.random().toString(36).slice(2, 10);

export default function App() {
  const [serverInfo, setServerInfo] = useState<HealthInfo | null>(null);
  const [audioSupported] = useState(() => StreamingPcmPlayer.isSupported());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);

  const playerRef = useRef<StreamingPcmPlayer>(new StreamingPcmPlayer());
  const turnsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchHealth()
      .then(setServerInfo)
      .catch((err) => console.error("health check failed", err));
  }, []);

  useEffect(() => {
    turnsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const send = async (payload: { text?: string; audio?: Blob }) => {
    if (busy) return;
    setBusy(true);
    const turnId = newId();
    const player = playerRef.current;

    setTurns((prev) => [
      ...prev,
      {
        id: turnId,
        user: payload.text ?? "",
        userSource: payload.audio ? "audio-pending" : "text",
        ai: "",
        status: "running",
        timing: {},
      },
    ]);

    try {
      // User-perceived STT clock: starts when we fire the request (so it covers
      // audio upload + network), stops when the transcript (stt event) arrives.
      const reqStart = Date.now();
      const handle = await startChat(payload);

      if (audioSupported && handle.config.audio.encoding === "PCM") {
        player.configure({
          sampleRateHertz: handle.config.audio.sampleRateHertz,
          channels: handle.config.audio.channels,
          bitsPerSample: handle.config.audio.bitsPerSample,
        });
        player.start();
      }

      subscribeChat(
        handle.sessionId,
        (ev: ChatEvent) => {
          setTurns((prev) =>
            prev.map((t) => {
              if (t.id !== turnId) return t;
              switch (ev.type) {
                case "stt":
                  return {
                    ...t,
                    user: ev.text,
                    userSource: ev.source,
                    timing:
                      ev.source === "audio"
                        ? { ...t.timing, sttClientMs: Date.now() - reqStart }
                        : t.timing,
                  };
                case "ai_delta":
                  return { ...t, ai: t.ai + ev.text };
                case "ai_complete":
                  return { ...t, ai: ev.text };
                case "tts_chunk":
                  if (
                    audioSupported &&
                    handle.config.audio.encoding === "PCM"
                  ) {
                    player.appendPcm(base64ToArrayBuffer(ev.audio));
                  }
                  return t;
                case "timing": {
                  const key =
                    ev.phase === "stt"
                      ? "sttMs"
                      : ev.phase === "ai_ttft"
                        ? "aiTtftMs"
                        : ev.phase === "ai_total"
                          ? "aiTotalMs"
                          : ev.phase === "tts_first_chunk"
                            ? "ttsFirstChunkMs"
                            : "ttsTotalMs";
                  return {
                    ...t,
                    timing: { ...t.timing, [key]: ev.ms },
                  };
                }
                case "done":
                  player.finish();
                  setBusy(false);
                  return { ...t, status: "done" };
                case "error":
                  player.finish();
                  setBusy(false);
                  return {
                    ...t,
                    status: "error",
                    errorMessage: ev.message,
                  };
                default:
                  return t;
              }
            }),
          );
        },
        (err) => {
          console.error("SSE transport error", err);
          setBusy(false);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === turnId
                ? {
                    ...t,
                    status: "error",
                    errorMessage: "SSE 연결이 끊겼습니다",
                  }
                : t,
            ),
          );
        },
      );
    } catch (e) {
      setBusy(false);
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                status: "error",
                errorMessage:
                  e instanceof Error ? e.message : "request failed",
              }
            : t,
        ),
      );
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void send({ text });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const fake = { preventDefault: () => {} } as FormEvent;
      onSubmit(fake);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-6 pb-32">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">hola</h1>
          {serverInfo && (
            <div className="flex flex-wrap gap-1 text-xs">
              <Badge variant="outline">
                STT · {serverInfo.stt.provider}/{serverInfo.stt.model}
              </Badge>
              <Badge variant="outline">
                AI · {serverInfo.ai.provider}/{serverInfo.ai.model}
              </Badge>
              <Badge variant="outline">
                TTS · {serverInfo.tts.provider}/{serverInfo.tts.voice}
              </Badge>
            </div>
          )}
        </header>

        {!audioSupported && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            이 브라우저는 Web Audio API를 지원하지 않습니다. 텍스트 응답만
            표시됩니다.
          </div>
        )}

        <main className="flex min-h-[60vh] flex-col gap-3">
          {turns.length === 0 ? (
            <div className="rounded-md border border-dashed py-16 text-center text-sm text-muted-foreground">
              메시지를 입력하거나 마이크 버튼을 눌러 시작하세요.
            </div>
          ) : (
            turns.map((t) => {
              const showUser = t.user.length > 0;
              const showAiBubble =
                t.ai.length > 0 || t.errorMessage !== undefined;
              const showAiTiming =
                t.timing.aiTtftMs !== undefined ||
                t.timing.aiTotalMs !== undefined;
              const showTtsTiming =
                t.timing.ttsFirstChunkMs !== undefined ||
                t.timing.ttsTotalMs !== undefined;
              return (
                <Fragment key={t.id}>
                  {(showUser || t.timing.sttClientMs !== undefined) && (
                    <div className="flex justify-end">
                      <div className="flex max-w-[80%] flex-col items-end gap-1">
                        {showUser && (
                          <div className="rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                            <p className="whitespace-pre-wrap break-words">
                              {t.user}
                            </p>
                          </div>
                        )}
                        {t.timing.sttClientMs !== undefined && (
                          <div className="px-1 text-[10px] text-sky-400">
                            STT 총 시간 {t.timing.sttClientMs}ms
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {(showAiBubble || showAiTiming || showTtsTiming) && (
                    <div className="flex justify-start">
                      <div className="flex max-w-[80%] flex-col items-start gap-1">
                        {showAiBubble && (
                          <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm">
                            {t.ai.length > 0 && (
                              <p className="whitespace-pre-wrap break-words">
                                {t.ai}
                              </p>
                            )}
                            {t.errorMessage && (
                              <p className="mt-2 text-xs text-destructive">
                                {t.errorMessage}
                              </p>
                            )}
                          </div>
                        )}
                        {showAiTiming && (
                          <div className="px-1 text-[10px] text-sky-400">
                            AI
                            {t.timing.aiTtftMs !== undefined &&
                              ` 첫 응답 ${t.timing.aiTtftMs}ms`}
                            {t.timing.aiTotalMs !== undefined &&
                              ` 총 시간 ${t.timing.aiTotalMs}ms`}
                          </div>
                        )}
                        {showTtsTiming && (
                          <div className="px-1 text-[10px] text-sky-400">
                            TTS
                            {t.timing.ttsFirstChunkMs !== undefined &&
                              ` 첫 응답 ${t.timing.ttsFirstChunkMs}ms`}
                            {t.timing.ttsTotalMs !== undefined &&
                              ` 총 시간 ${t.timing.ttsTotalMs}ms`}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })
          )}
          <div ref={turnsEndRef} />
        </main>
      </div>

      <form
        onSubmit={onSubmit}
        className="fixed inset-x-0 bottom-0 border-t bg-background"
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2 p-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder=""
            disabled={busy}
            rows={2}
            className="resize-none"
          />
          <div className="flex flex-col gap-1">
            <Recorder
              disabled={busy}
              onCaptured={(blob) => void send({ audio: blob })}
            />
            <Button
              type="submit"
              disabled={busy || input.trim().length === 0}
              size="icon"
              title="Send"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
