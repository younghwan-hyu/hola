import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ChevronDown,
  FileUp,
  Loader2,
  MoreHorizontal,
  Send,
  Smile,
  X,
} from "lucide-react";

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
  uploadDocument,
  type ChatEvent,
} from "@/lib/api";
import { GESTURES, isAvatarGesture, type AvatarGesture } from "@/lib/gestures";
import { base64ToArrayBuffer, StreamingPcmPlayer } from "@/lib/audio";

const AVATAR_URL = import.meta.env.VITE_AVATAR_URL ?? "/avatar.vrm";

type Role = "user" | "ai";

interface Bubble {
  id: string;
  role: Role;
  text: string;
  error?: string;
  /** true while the bubble is sliding up and out, just before removal. */
  leaving?: boolean;
}

const newId = () => Math.random().toString(36).slice(2, 10);

const MAX_BUBBLES = 2; // most bubbles visible at once
const EXIT_MS = 350; // keep a leaving bubble around this long for its exit anim

/**
 * Append a bubble to the rolling window. Once at capacity, the oldest still-live
 * bubble is marked `leaving` (kept in the list so it can animate up and out) —
 * so exactly one bubble leaves whenever a new one (user OR ai) appears.
 */
function addBubble(prev: Bubble[], next: Bubble): Bubble[] {
  const leaving = prev.filter((b) => b.leaving);
  const live = prev.filter((b) => !b.leaving);
  const combined = [...live, next];
  if (combined.length <= MAX_BUBBLES) return [...leaving, ...combined];
  const overflow = combined.length - MAX_BUBBLES;
  const newlyLeaving = combined
    .slice(0, overflow)
    .map((b) => ({ ...b, leaving: true }));
  return [...leaving, ...newlyLeaving, ...combined.slice(overflow)];
}

export default function App() {
  const [audioSupported] = useState(() => StreamingPcmPlayer.isSupported());
  const [avatarStatus, setAvatarStatus] = useState<AvatarStatus>("loading");
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Chat as a rolling window of at most MAX_BUBBLES message bubbles (user & ai).
  const [items, setItems] = useState<Bubble[]>([]);
  const [gestureOpen, setGestureOpen] = useState(false);
  // Input is voice-first: collapsed shows only a hero mic + "..."; expanding
  // reveals the full bar (text input + gesture button).
  const [expanded, setExpanded] = useState(false);
  // Document upload (RAG) is independent of the chat `busy` state.
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const playerRef = useRef<StreamingPcmPlayer>(new StreamingPcmPlayer());
  const avatarRef = useRef<AvatarHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMsgTimer = useRef<number | null>(null);
  const leavingTimers = useRef<Map<string, number>>(new Map());

  const flashUploadMsg = (msg: string) => {
    setUploadMsg(msg);
    if (uploadMsgTimer.current !== null)
      window.clearTimeout(uploadMsgTimer.current);
    uploadMsgTimer.current = window.setTimeout(() => setUploadMsg(null), 4000);
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const r = await uploadDocument(file);
      flashUploadMsg(
        r.skipped ? `${r.filename} 이미 저장됨` : `${r.filename} 저장됨`,
      );
    } catch (e) {
      flashUploadMsg(
        `업로드 실패: ${e instanceof Error ? e.message : "unknown"}`,
      );
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    return () => {
      playerRef.current.dispose();
      for (const t of leavingTimers.current.values()) window.clearTimeout(t);
      leavingTimers.current.clear();
      if (uploadMsgTimer.current !== null)
        window.clearTimeout(uploadMsgTimer.current);
    };
  }, []);

  // Remove each leaving bubble after its exit animation. Scheduled exactly once
  // per bubble (guarded by the ref) so streaming re-renders don't reset it.
  useEffect(() => {
    for (const b of items) {
      if (b.leaving && !leavingTimers.current.has(b.id)) {
        const timer = window.setTimeout(() => {
          leavingTimers.current.delete(b.id);
          setItems((prev) => prev.filter((x) => x.id !== b.id));
        }, EXIT_MS);
        leavingTimers.current.set(b.id, timer);
      }
    }
  }, [items]);

  const send = async (payload: { text?: string; audio?: Blob }) => {
    if (busy) return;
    setBusy(true);
    const turnId = newId();
    const userId = `${turnId}:u`;
    const aiId = `${turnId}:a`;
    const player = playerRef.current;

    // Text input: the user message is known now (audio: added on the stt event).
    if (payload.text && payload.text.length > 0) {
      const text = payload.text;
      setItems((prev) => addBubble(prev, { id: userId, role: "user", text }));
    }

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

      // The AI bubble is created on its first text (or error), then updated.
      let aiCreated = false;
      const onAiText = (text: string, append: boolean) => {
        if (!aiCreated) {
          aiCreated = true;
          setItems((prev) => addBubble(prev, { id: aiId, role: "ai", text }));
        } else {
          setItems((prev) =>
            prev.map((b) =>
              b.id === aiId ? { ...b, text: append ? b.text + text : text } : b,
            ),
          );
        }
      };
      const onAiError = (message: string) => {
        player.finish();
        setBusy(false);
        if (!aiCreated) {
          aiCreated = true;
          setItems((prev) =>
            addBubble(prev, { id: aiId, role: "ai", text: "", error: message }),
          );
        } else {
          setItems((prev) =>
            prev.map((b) => (b.id === aiId ? { ...b, error: message } : b)),
          );
        }
      };

      subscribeChat(
        handle.sessionId,
        (ev: ChatEvent) => {
          switch (ev.type) {
            case "stt":
              // For audio, the user bubble appears once the transcript is known.
              if (ev.source === "audio") {
                setItems((prev) =>
                  addBubble(prev, { id: userId, role: "user", text: ev.text }),
                );
              }
              return;
            case "gesture":
              if (isAvatarGesture(ev.name)) avatarRef.current?.playGesture(ev.name);
              return;
            case "ai_delta":
              onAiText(ev.text, true);
              return;
            case "ai_complete":
              onAiText(ev.text, false);
              return;
            case "tts_chunk":
              if (audioSupported && handle.config.audio.encoding === "PCM") {
                player.appendPcm(base64ToArrayBuffer(ev.audio));
              }
              return;
            case "done":
              player.finish();
              setBusy(false);
              return;
            case "error":
              onAiError(ev.message);
              return;
          }
        },
        (err) => {
          console.error("SSE transport error", err);
          onAiError("SSE 연결이 끊겼습니다");
        },
      );
    } catch (e) {
      setBusy(false);
      const message = e instanceof Error ? e.message : "request failed";
      setItems((prev) =>
        addBubble(prev, { id: aiId, role: "ai", text: "", error: message }),
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

      {/* Chat: a rolling window of message bubbles. Each enters by sliding up
          from below; the oldest leaves by sliding up and out. */}
      <div
        className={`pointer-events-none absolute inset-x-0 ${
          expanded ? "bottom-24" : "bottom-28"
        } mx-auto flex max-w-2xl flex-col gap-2 px-4`}
      >
        {items.map((b) => (
          <div
            key={b.id}
            className={`flex ${
              b.role === "user" ? "justify-end" : "justify-start"
            } duration-300 ${
              b.leaving
                ? "animate-out fade-out-0 slide-out-to-top-4 fill-mode-forwards"
                : "animate-in fade-in-0 slide-in-from-bottom-3"
            }`}
          >
            {b.role === "user" ? (
              <div className="max-w-[80%] rounded-2xl rounded-br-sm border border-white/15 bg-black/40 px-4 py-2 text-sm text-white shadow-lg backdrop-blur">
                <p className="whitespace-pre-wrap break-words">{b.text}</p>
              </div>
            ) : (
              <div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-white/15 bg-black/40 px-4 py-2 text-sm leading-relaxed text-white shadow-lg backdrop-blur">
                {b.text.length > 0 && (
                  <p className="whitespace-pre-wrap break-words">{b.text}</p>
                )}
                {b.error && (
                  <p className="mt-1 text-xs text-destructive">{b.error}</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {uploadMsg && (
        <div
          className={`pointer-events-none absolute inset-x-0 ${
            expanded ? "bottom-40" : "bottom-44"
          } flex justify-center px-4`}
        >
          <div className="animate-in fade-in-0 slide-in-from-bottom-2 rounded-full border border-white/15 bg-black/50 px-4 py-2 text-xs text-white/90 shadow-lg backdrop-blur">
            {uploadMsg}
          </div>
        </div>
      )}

      {!audioSupported && (
        <div
          className={`pointer-events-none absolute inset-x-0 ${
            expanded ? "bottom-24" : "bottom-28"
          } flex justify-center px-4`}
        >
          <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive">
            이 브라우저는 Web Audio API를 지원하지 않아 음성 출력이 재생되지
            않습니다.
          </div>
        </div>
      )}

      {/* Voice-first input. Collapsed: mic + file upload + "..." in a row.
          "..." reveals the full bar (text input + gesture + send). */}
      {!expanded ? (
        <div className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            className="hidden"
            onChange={(e) => {
              void onFilePicked(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {/* Order: 음성(mic) - 파일(upload) - ...(more). */}
          <Recorder
            size="lg"
            disabled={busy}
            onCaptured={(blob) => void send({ audio: blob })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={uploading}
            title="문서 업로드"
            className="h-16 w-16 shrink-0 rounded-full border border-white/15 bg-black/40 text-white shadow-lg shadow-black/30 backdrop-blur hover:bg-black/55 hover:text-white"
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <FileUp className="h-6 w-6" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-12 w-12 shrink-0 rounded-full border border-white/15 bg-black/40 text-white shadow-lg shadow-black/30 backdrop-blur hover:bg-black/55 hover:text-white"
            onClick={() => setExpanded(true)}
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-black/30 backdrop-blur"
        >
          <div className="mx-auto flex max-w-2xl items-end gap-2 p-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 text-white/60 hover:text-white"
              onClick={() => setExpanded(false)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
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
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>
      )}

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
