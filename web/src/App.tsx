import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Keyboard, Loader2, Mic, Send, Volume2 } from "lucide-react";

import { Recorder } from "@/components/Recorder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
      },
    ]);

    try {
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
                  return { ...t, user: ev.text, userSource: ev.source };
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
            turns.map((t) => (
              <Card key={t.id}>
                <CardContent className="flex flex-col gap-3">
                  <div>
                    <Badge variant="secondary" className="mb-1 gap-1">
                      {t.userSource === "audio" ||
                      t.userSource === "audio-pending" ? (
                        <Mic className="h-3 w-3" />
                      ) : (
                        <Keyboard className="h-3 w-3" />
                      )}
                      You
                    </Badge>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {t.userSource === "audio-pending" && !t.user
                        ? "음성 인식 중..."
                        : t.user || "..."}
                    </p>
                  </div>
                  <div>
                    <Badge className="mb-1 gap-1">
                      Assistant
                      {t.status === "running" && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      {audioSupported && t.status !== "error" && (
                        <Volume2 className="h-3 w-3" />
                      )}
                    </Badge>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {t.ai || (t.status === "running" ? "..." : "")}
                    </p>
                    {t.errorMessage && (
                      <p className="mt-2 text-xs text-destructive">
                        {t.errorMessage}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
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
            placeholder="메시지를 입력하거나 마이크 버튼을 누르세요"
            disabled={busy}
            rows={2}
            className="resize-none"
          />
          <div className="flex flex-col gap-1">
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
            <Recorder
              disabled={busy}
              onCaptured={(blob) => void send({ audio: blob })}
            />
          </div>
        </div>
      </form>
    </div>
  );
}
