import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Loader2, Send, Smile, X } from "lucide-react";

import {
  Avatar,
  type AvatarHandle,
  type AvatarStatus,
} from "@/components/Avatar";
import { Recorder } from "@/components/Recorder";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  startChat,
  subscribeChat,
  type ChatEvent,
} from "@/lib/api";
import { GESTURES, isAvatarGesture, type AvatarGesture } from "@/lib/gestures";
import { base64ToArrayBuffer, StreamingPcmPlayer } from "@/lib/audio";

const AVATAR_URL = import.meta.env.VITE_AVATAR_URL ?? "/avatar.vrm";

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
  const [audioSupported] = useState(() => StreamingPcmPlayer.isSupported());
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("loading");
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turn, setTurn] = useState<Turn | null>(null);
  const [gestureOpen, setGestureOpen] = useState(false);

  const playerRef = useRef<StreamingPcmPlayer>(new StreamingPcmPlayer());
  const avatarRef = useRef<AvatarHandle>(null);

  useEffect(() => {
    return () => playerRef.current.dispose();
  }, []);

  const send = async (payload: { text?: string; audio?: Blob }) => {
    if (busy) return;
    setBusy(true);
    const turnId = newId();
    const player = playerRef.current;

    setTurn({
      id: turnId,
      user: payload.text ?? "",
      userSource: payload.audio ? "audio-pending" : "text",
      ai: "",
      status: "running",
    });

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
          // Gesture commands parsed out of the AI stream: play them on the
          // avatar. Pure side effect — no chat-turn state to update.
          if (ev.type === "gesture") {
            if (isAvatarGesture(ev.name)) {
              avatarRef.current?.playGesture(ev.name);
            }
            return;
          }
          setTurn((prev) => {
            if (!prev || prev.id !== turnId) return prev;
            switch (ev.type) {
              case "stt":
                return { ...prev, user: ev.text, userSource: ev.source };
              case "ai_delta":
                return { ...prev, ai: prev.ai + ev.text };
              case "ai_complete":
                return { ...prev, ai: ev.text };
              case "tts_chunk":
                if (audioSupported && handle.config.audio.encoding === "PCM") {
                  player.appendPcm(base64ToArrayBuffer(ev.audio));
                }
                return prev;
              case "done":
                player.finish();
                setBusy(false);
                return { ...prev, status: "done" };
              case "error":
                player.finish();
                setBusy(false);
                return {
                  ...prev,
                  status: "error",
                  errorMessage: ev.message,
                };
              default:
                return prev;
            }
          });
        },
        (err) => {
          console.error("SSE transport error", err);
          setBusy(false);
          setTurn((prev) =>
            prev && prev.id === turnId
              ? { ...prev, status: "error", errorMessage: "SSE 연결이 끊겼습니다" }
              : prev,
          );
        },
      );
    } catch (e) {
      setBusy(false);
      setTurn((prev) =>
        prev && prev.id === turnId
          ? {
              ...prev,
              status: "error",
              errorMessage: e instanceof Error ? e.message : "request failed",
            }
          : prev,
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
      onSubmit({ preventDefault: () => {} } as FormEvent);
    }
  };

  const triggerGesture = (gesture: AvatarGesture) => {
    avatarRef.current?.playGesture(gesture);
    setGestureOpen(false);
  };

  const showUser =
    turn && turn.user.length > 0 && turn.userSource !== "audio-pending";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[radial-gradient(ellipse_at_center,_hsl(222_47%_13%)_0%,_hsl(222_84%_5%)_70%)]">
      {/* 3D avatar fills the viewport */}
      <div className="absolute inset-0">
        <Avatar
          ref={avatarRef}
          avatarUrl={AVATAR_URL}
          getMouthLevel={() => playerRef.current.getLevel()}
          onStatus={(status, message) => {
            setAvatarStatus(status);
            setAvatarError(message ?? null);
          }}
        />
      </div>

      {/* Avatar loading / error overlay */}
      {avatarStatus !== "ready" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {avatarStatus === "loading" ? (
            <div className="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-sm text-white/80 backdrop-blur">
              <Loader2 className="h-4 w-4 animate-spin" />
              아바타 불러오는 중…
            </div>
          ) : (
            <div className="max-w-sm rounded-md border border-destructive/40 bg-destructive/15 px-4 py-3 text-center text-sm text-destructive">
              아바타를 불러오지 못했습니다
              {avatarError && (
                <p className="mt-1 text-xs opacity-80">{avatarError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 p-4">
        <h1 className="text-lg font-semibold tracking-tight text-white">
          hola
        </h1>
      </header>

      {/* Latest exchange as chat bubbles above the input bar (one each) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-28 mx-auto flex max-w-2xl flex-col gap-2 px-4">
        {showUser && turn && (
          <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-sky-500/90 px-4 py-2 text-sm text-white shadow-lg backdrop-blur">
              <p className="whitespace-pre-wrap break-words">{turn.user}</p>
            </div>
          </div>
        )}
        {turn && (turn.ai.length > 0 || turn.errorMessage) && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-black/55 px-4 py-2 text-sm leading-relaxed text-white shadow-lg backdrop-blur">
              {turn.ai.length > 0 && (
                <p className="whitespace-pre-wrap break-words">{turn.ai}</p>
              )}
              {turn.errorMessage && (
                <p className="mt-1 text-xs text-destructive">
                  {turn.errorMessage}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {!audioSupported && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center px-4">
          <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive">
            이 브라우저는 Web Audio API를 지원하지 않아 음성 출력이 재생되지
            않습니다.
          </div>
        </div>
      )}

      {/* Input bar */}
      <form
        onSubmit={onSubmit}
        className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-black/30 backdrop-blur"
      >
        <div className="mx-auto flex max-w-2xl items-end gap-2 p-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="메시지를 입력하거나 마이크 버튼을 누르세요"
            disabled={busy}
            rows={1}
            className="min-h-[44px] resize-none border-white/15 bg-white/5 text-white placeholder:text-white/40"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            title="제스처"
            onClick={() => setGestureOpen(true)}
          >
            <Smile className="h-4 w-4" />
          </Button>
          <Recorder
            disabled={busy}
            onCaptured={(blob) => void send({ audio: blob })}
          />
          <Button
            type="submit"
            disabled={busy || input.trim().length === 0}
            size="icon"
            className="h-11 w-11 shrink-0"
            title="Send"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </form>

      {/* Gesture modal */}
      {gestureOpen && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setGestureOpen(false)}
        >
          <div
            className="relative w-full max-w-xs rounded-2xl border border-white/10 bg-zinc-900/95 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              title="닫기"
              onClick={() => setGestureOpen(false)}
              className="absolute right-3 top-3 text-white/50 transition-colors hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            <h2 className="mb-4 text-base font-semibold text-white">제스처</h2>
            <div className="flex flex-col gap-2">
              {GESTURES.map(({ id, label, icon: Icon }) => (
                <Button
                  key={id}
                  type="button"
                  variant="secondary"
                  className="h-12 justify-start gap-3 text-sm"
                  onClick={() => triggerGesture(id)}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
