import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  Camera,
  ChevronDown,
  FileUp,
  Loader2,
  MoreHorizontal,
  Send,
  Smile,
  SwitchCamera,
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
  /** Object URL of the camera frame sent with this turn, shown as a thumbnail. */
  imageUrl?: string;
  /** true while the bubble is sliding up and out, just before removal. */
  leaving?: boolean;
}

const newId = () => Math.random().toString(36).slice(2, 10);

const MAX_BUBBLES = 2; // most bubbles visible at once
const EXIT_MS = 350; // keep a leaving bubble around this long for its exit anim

// The camera preview fits inside this box while preserving the real stream
// ratio: landscape streams fill the width, portrait streams are bounded by the
// height (so they shrink in width) instead of growing oversized in the corner.
const PREVIEW_MAX_W = 208; // px (was the fixed w-52 width)
const PREVIEW_MAX_H = 240; // px

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
  // Input is voice-first: collapsed shows a row of mic + file + camera + "...";
  // expanding reveals the full bar (text input + gesture + send).
  const [expanded, setExpanded] = useState(false);
  // Document upload (RAG) is independent of the chat `busy` state.
  const [uploading, setUploading] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  // Camera: when on, a live preview shows and each sent turn attaches a frame.
  const [cameraOn, setCameraOn] = useState(false);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  // Number of video inputs (known after permission); the front/back switch is
  // only shown when there are 2+ (e.g. phones, not a single-webcam PC).
  const [videoInputCount, setVideoInputCount] = useState(0);
  // Preview aspect ratio (width / height), read from the actual stream so the
  // top-right preview matches the real camera frame instead of a fixed 16:9
  // crop. null until the first `loadedmetadata` (falls back to 16:9).
  const [previewAspect, setPreviewAspect] = useState<number | null>(null);

  const playerRef = useRef<StreamingPcmPlayer>(new StreamingPcmPlayer());
  const avatarRef = useRef<AvatarHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStartingRef = useRef(false);
  const mountedRef = useRef(true);
  // Live object URLs for sent-image thumbnails, revoked when their bubble leaves.
  const objectUrls = useRef<Set<string>>(new Set());
  const toastTimer = useRef<number | null>(null);
  const leavingTimers = useRef<Map<string, number>>(new Map());

  const flashToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current !== null)
      window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 4000);
  };

  const onFilePicked = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    setToastMsg(null);
    try {
      const r = await uploadDocument(file);
      flashToast(
        r.skipped ? `${r.filename} 이미 저장됨` : `${r.filename} 저장됨`,
      );
    } catch (e) {
      flashToast(
        `업로드 실패: ${e instanceof Error ? e.message : "unknown"}`,
      );
    } finally {
      setUploading(false);
    }
  };

  const stopCamera = () => {
    const stream = cameraStreamRef.current;
    if (stream) for (const t of stream.getTracks()) t.stop();
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    setPreviewAspect(null);
  };

  const startStream = (mode: "user" | "environment") =>
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

  const toggleCamera = async () => {
    if (cameraOn) {
      stopCamera();
      setCameraOn(false);
      return;
    }
    // navigator.mediaDevices (and thus getUserMedia) only exists in a secure
    // context — HTTPS or localhost. Over plain http (e.g. a phone hitting the
    // LAN dev server) it is undefined, so guard before touching it instead of
    // throwing "cannot read properties of undefined (reading 'getUserMedia')".
    if (!navigator.mediaDevices?.getUserMedia) {
      flashToast(
        window.isSecureContext
          ? "이 브라우저에서는 카메라를 사용할 수 없습니다."
          : "카메라는 HTTPS 또는 localhost 접속에서만 켤 수 있습니다 (현재 http 접속).",
      );
      return;
    }
    // Guard the async start: a second click (or a click while already on) must
    // not open a second MediaStream that would leak the camera.
    if (cameraStartingRef.current || cameraStreamRef.current) return;
    cameraStartingRef.current = true;
    try {
      const stream = await startStream(facingMode);
      // If we unmounted while the prompt was open, release the stream now.
      if (!mountedRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      cameraStreamRef.current = stream;
      setCameraOn(true); // preview <video> mounts, then an effect binds the stream
      // Now that permission is granted, count cameras to decide whether to show
      // the front/back switch (labels/count are only reliable post-permission).
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setVideoInputCount(
          devices.filter((d) => d.kind === "videoinput").length,
        );
      } catch {
        /* enumerateDevices unsupported — leave the switch hidden */
      }
    } catch (e) {
      stopCamera();
      setCameraOn(false);
      flashToast(
        `카메라를 켤 수 없습니다: ${e instanceof Error ? e.message : "권한 거부"}`,
      );
    } finally {
      cameraStartingRef.current = false;
    }
  };

  // Flip between front ("user") and back ("environment") cameras. Only reachable
  // from the switch button, which is shown when 2+ video inputs exist.
  const switchCamera = async () => {
    if (cameraStartingRef.current || !cameraStreamRef.current) return;
    const next = facingMode === "user" ? "environment" : "user";
    cameraStartingRef.current = true;
    try {
      const stream = await startStream(next);
      if (!mountedRef.current) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      const old = cameraStreamRef.current;
      if (old) for (const t of old.getTracks()) t.stop();
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream;
      setFacingMode(next);
    } catch (e) {
      flashToast(
        `카메라 전환 실패: ${e instanceof Error ? e.message : "unknown"}`,
      );
    } finally {
      cameraStartingRef.current = false;
    }
  };

  // Capture the current preview frame as a downscaled JPEG (long edge 1024px).
  // Not mirrored — the model gets the real scene. null if the video isn't ready.
  const captureFrame = async (): Promise<Blob | null> => {
    const video = cameraVideoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
    const scale = Math.min(
      1,
      1024 / Math.max(video.videoWidth, video.videoHeight),
    );
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8),
    );
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      playerRef.current.dispose();
      for (const t of leavingTimers.current.values()) window.clearTimeout(t);
      leavingTimers.current.clear();
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
      const stream = cameraStreamRef.current;
      if (stream) for (const t of stream.getTracks()) t.stop();
      for (const u of objectUrls.current) URL.revokeObjectURL(u);
      objectUrls.current.clear();
    };
  }, []);

  // Bind the camera stream to the preview <video> once it has mounted.
  useEffect(() => {
    if (cameraOn && cameraVideoRef.current && cameraStreamRef.current) {
      cameraVideoRef.current.srcObject = cameraStreamRef.current;
    }
  }, [cameraOn]);

  // Remove each leaving bubble after its exit animation. Scheduled exactly once
  // per bubble (guarded by the ref) so streaming re-renders don't reset it.
  useEffect(() => {
    for (const b of items) {
      if (b.leaving && !leavingTimers.current.has(b.id)) {
        const timer = window.setTimeout(() => {
          leavingTimers.current.delete(b.id);
          if (b.imageUrl) {
            URL.revokeObjectURL(b.imageUrl);
            objectUrls.current.delete(b.imageUrl);
          }
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

    // Camera on: capture a fresh frame first so the user bubble can show it as a
    // thumbnail. A failed capture must not block the message.
    const image = cameraOn
      ? ((await captureFrame().catch(() => null)) ?? undefined)
      : undefined;
    let imageUrl: string | undefined;
    if (image) {
      imageUrl = URL.createObjectURL(image);
      objectUrls.current.add(imageUrl);
    }

    // Text input: the user message is known now (audio: added on the stt event).
    if (payload.text && payload.text.length > 0) {
      const text = payload.text;
      setItems((prev) =>
        addBubble(prev, { id: userId, role: "user", text, imageUrl }),
      );
    }

    try {
      const handle = await startChat({ ...payload, image });

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
                  addBubble(prev, {
                    id: userId,
                    role: "user",
                    text: ev.text,
                    imageUrl,
                  }),
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

  // Fit the preview inside PREVIEW_MAX_W x PREVIEW_MAX_H, keeping the real ratio:
  // width-bound for wide streams, height-bound (narrower) for tall ones.
  const previewRatio = previewAspect ?? 16 / 9;
  const previewW = Math.round(
    Math.min(PREVIEW_MAX_W, PREVIEW_MAX_H * previewRatio),
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(ellipse_at_center,_hsl(222_47%_13%)_0%,_hsl(222_84%_5%)_70%)]">
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
                {b.imageUrl && (
                  <img
                    src={b.imageUrl}
                    alt="첨부한 카메라 이미지"
                    className="mx-auto mb-1.5 block max-h-24 w-auto rounded-lg object-cover"
                  />
                )}
                {b.text.length > 0 && (
                  <p className="whitespace-pre-wrap break-words">{b.text}</p>
                )}
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

      {toastMsg && (
        <div
          className={`pointer-events-none absolute inset-x-0 ${
            expanded ? "bottom-40" : "bottom-44"
          } flex justify-center px-4`}
        >
          <div className="animate-in fade-in-0 slide-in-from-bottom-2 rounded-full border border-white/15 bg-black/50 px-4 py-2 text-xs text-white/90 shadow-lg backdrop-blur">
            {toastMsg}
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

      {/* Live camera preview, top-right while the camera is on. Front camera is
          mirrored (selfie), back camera is not. Toggle off with the camera
          button. Captured frames are always un-mirrored (see captureFrame). */}
      {cameraOn && (
        <div className="absolute right-4 top-4 z-[5] flex flex-col items-end gap-2">
          <div
            className="overflow-hidden rounded-xl border border-white/20 shadow-lg shadow-black/40"
            style={{ width: previewW }}
          >
            <video
              ref={cameraVideoRef}
              autoPlay
              muted
              playsInline
              // Match the box to the real stream ratio (fires again on camera
              // switch, when a new srcObject is bound) so the preview reflects
              // exactly what captureFrame() sends — no fixed-16:9 crop.
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth > 0 && v.videoHeight > 0)
                  setPreviewAspect(v.videoWidth / v.videoHeight);
              }}
              style={{ aspectRatio: previewRatio }}
              className={`w-full object-cover ${
                facingMode === "user" ? "-scale-x-100" : ""
              }`}
            />
          </div>
          {/* Front/back switch — only when the device has 2+ cameras (phones). */}
          {videoInputCount >= 2 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="전/후면 카메라 전환"
              onClick={() => void switchCamera()}
              className="h-8 gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 text-xs text-white shadow-lg backdrop-blur hover:bg-black/70 hover:text-white"
            >
              <SwitchCamera className="h-3.5 w-3.5" />
              전환
            </Button>
          )}
        </div>
      )}

      {/* Voice-first input. Collapsed: mic + file upload + camera + "..." in a row.
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
          {/* Order: 음성(mic) - 카메라(camera) - 파일(upload) - ...(more). */}
          <Recorder
            size="lg"
            disabled={busy}
            onCaptured={(blob) => void send({ audio: blob })}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={cameraOn ? "카메라 끄기" : "카메라 켜기"}
            className={
              cameraOn
                ? "h-16 w-16 shrink-0 rounded-full bg-white text-black shadow-lg shadow-black/30 hover:bg-white/90 hover:text-black"
                : "h-16 w-16 shrink-0 rounded-full border border-white/15 bg-black/40 text-white shadow-lg shadow-black/30 backdrop-blur hover:bg-black/55 hover:text-white"
            }
            onClick={() => void toggleCamera()}
          >
            <Camera className="h-6 w-6" />
          </Button>
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
