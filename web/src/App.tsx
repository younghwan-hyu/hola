import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  FileUp,
  Loader2,
  MoreHorizontal,
  Send,
  Smile,
  Square,
  SwitchCamera,
  UserRound,
  X,
} from "lucide-react";

import {
  Avatar,
  type AvatarHandle,
  type AvatarStatus,
} from "@/components/Avatar";
import { DocViewer, type DocViewerHandle } from "@/components/DocViewer";
import { Recorder } from "@/components/Recorder";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  startChat,
  subscribeChat,
  uploadDocument,
  type ChatEvent,
} from "@/lib/api";
import {
  avatarLabel,
  fetchAvatars,
  pickInitialAvatar,
  storeAvatar,
} from "@/lib/avatars";
import {
  fetchPerceptionChecks,
  runPerceptionCheck,
  type PerceptionCheckInfo,
} from "@/lib/perception";
import { GESTURES, isAvatarGesture, type AvatarGesture } from "@/lib/gestures";
import { base64ToArrayBuffer, StreamingPcmPlayer } from "@/lib/audio";

type Role = "user" | "ai";

interface Bubble {
  id: string;
  role: Role;
  text: string;
  error?: string;
  /** Object URL of the camera frame sent with this turn, shown as a thumbnail. */
  imageUrl?: string;
  /** Object URL of the doc-page capture sent with this turn (문서 조회 모드). */
  docUrl?: string;
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
  // id of the AI bubble whose TTS audio is currently playing — drives the small
  // stop button under that bubble. null when nothing is speaking.
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  // Chat as a rolling window of at most MAX_BUBBLES message bubbles (user & ai).
  const [items, setItems] = useState<Bubble[]>([]);
  const [gestureOpen, setGestureOpen] = useState(false);
  // Avatar list, fetched from public/avatars.json on mount (see lib/avatars.ts).
  const [avatars, setAvatars] = useState<string[]>([]);
  // URL of the selected VRM model; null until the manifest resolves. Changing it
  // reloads <Avatar> (avatarUrl is its effect dep), which re-reports
  // "loading" -> "ready" on its own.
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  // Input is voice-first: collapsed shows a row of mic + file + camera + "...";
  // expanding reveals the full bar (text input + gesture + send).
  const [expanded, setExpanded] = useState(false);
  // Document upload (RAG) is independent of the chat `busy` state.
  const [uploading, setUploading] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  // 문서 조회 모드: when on, a PDF viewer pane shows left of the avatar and
  // each sent turn attaches a capture of the page being viewed.
  const [docMode, setDocMode] = useState(false);
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

  // Perception checks the server wants polled while the camera is on.
  const [perceptionChecks, setPerceptionChecks] = useState<
    PerceptionCheckInfo[]
  >([]);

  const playerRef = useRef<StreamingPcmPlayer>(new StreamingPcmPlayer());
  /**
   * A turn is starting or streaming. `busy` state drives the UI, but state is
   * async — two callers in the same tick both read it as `false`, so a
   * perception nudge landing exactly as the user hits send would open two
   * overlapping turns. This ref flips synchronously, so whoever gets here first
   * owns the turn; the polling timer also reads it without having to restart on
   * every render.
   */
  const turnInFlight = useRef(false);
  /**
   * ONE arm shared by every perception check, not one per check: whichever
   * check speaks first silences all of them, so the avatar can never stack
   * "어디 가셨어요?" and "뭘 보고 계세요?" on top of each other.
   *
   * Only a real user turn re-arms it (see `send`) — merely reappearing on
   * camera does not, or stepping in and out of frame without saying anything
   * would have the avatar asking over and over. Also cleared while the camera
   * is off, so a verdict still in flight can't nudge after the preview is gone.
   */
  const perceptionArmed = useRef(true);
  /** Per-check debounce state: how many equal verdicts in a row (`consecutive`). */
  const perceptionState = useRef(
    new Map<string, { label: string; count: number }>(),
  );
  /**
   * Serializes ticks across checks: at most one classify call in flight, so two
   * checks can neither race each other into a verdict nor bill two vision calls
   * at the same instant.
   */
  const perceptionTicking = useRef(false);
  // aiId of a turn whose voice the user stopped, so late-arriving tts_chunks
  // don't reappend audio or resurrect its stop button.
  const stoppedTurnRef = useRef<string | null>(null);
  const avatarRef = useRef<AvatarHandle>(null);
  const docViewerRef = useRef<DocViewerHandle>(null);
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

  // Capture the current preview frame as a downscaled JPEG. Not mirrored — the
  // model gets the real scene. null if the video isn't ready. Perception polling
  // passes a much smaller size/quality than a conversation turn does.
  const captureFrame = async (
    maxPx = 1024,
    quality = 0.8,
  ): Promise<Blob | null> => {
    const video = cameraVideoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
    const scale = Math.min(
      1,
      maxPx / Math.max(video.videoWidth, video.videoHeight),
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
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
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

  // Resolve the avatar list at runtime, then show the last-picked model (or the
  // first entry). Until this lands the avatar isn't mounted, so the "loading"
  // overlay that's already up just stays until the VRM itself is ready.
  useEffect(() => {
    let cancelled = false;
    void fetchAvatars().then((list) => {
      if (cancelled) return;
      setAvatars(list);
      setAvatar(pickInitialAvatar(list));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // What to poll while the camera is on. Discovered from the server so a new
  // check needs no client change; [] (feature off) if it can't be reached.
  useEffect(() => {
    let cancelled = false;
    void fetchPerceptionChecks().then((checks) => {
      if (!cancelled) setPerceptionChecks(checks);
    });
    return () => {
      cancelled = true;
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
          for (const url of [b.imageUrl, b.docUrl]) {
            if (url) {
              URL.revokeObjectURL(url);
              objectUrls.current.delete(url);
            }
          }
          setItems((prev) => prev.filter((x) => x.id !== b.id));
        }, EXIT_MS);
        leavingTimers.current.set(b.id, timer);
      }
    }
  }, [items]);

  // Once a turn is done (busy false), hide its stop button when the audio has
  // fully drained. Guarded by `busy` so brief mid-stream gaps don't clear it.
  useEffect(() => {
    if (!speakingId || busy) return;
    const player = playerRef.current;
    const id = window.setInterval(() => {
      if (!player.isPlaying()) {
        setSpeakingId(null);
        window.clearInterval(id);
      }
    }, 150);
    return () => window.clearInterval(id);
  }, [speakingId, busy]);

  const stopSpeaking = (id: string) => {
    playerRef.current.stop();
    stoppedTurnRef.current = id;
    setSpeakingId(null);
  };

  const send = async (payload: {
    text?: string;
    audio?: Blob;
    /**
     * Machine-initiated turn (a perception signal): the text is a sensor token
     * for the model, not something the user said, so no user bubble is shown.
     * The avatar's reply renders as a normal AI bubble.
     */
    hidden?: boolean;
  }) => {
    if (turnInFlight.current) return;
    turnInFlight.current = true;
    // A turn the user actually initiated re-arms perception: having asked once,
    // the avatar waits for an answer rather than asking again.
    if (!payload.hidden) {
      perceptionArmed.current = true;
      perceptionState.current.clear();
    }
    setBusy(true);
    setSpeakingId(null);
    stoppedTurnRef.current = null;
    const turnId = newId();
    const userId = `${turnId}:u`;
    const aiId = `${turnId}:a`;
    const player = playerRef.current;
    // Release the turn lock together with the UI's busy flag — they must never
    // drift apart, or the next send() is refused forever.
    const endTurn = () => {
      turnInFlight.current = false;
      setBusy(false);
    };

    // Camera on: capture a fresh frame first so the user bubble can show it as a
    // thumbnail. A failed capture must not block the message.
    //
    // Machine-initiated (hidden) turns deliberately send NO frame: a perception
    // check already looked, and handing the model a picture of the empty room
    // makes it describe the scene instead of speaking to the absent user.
    const image =
      cameraOn && !payload.hidden
        ? ((await captureFrame().catch(() => null)) ?? undefined)
        : undefined;
    // No bubble for a hidden turn, so don't mint an object URL nothing revokes.
    let imageUrl: string | undefined;
    if (image && !payload.hidden) {
      imageUrl = URL.createObjectURL(image);
      objectUrls.current.add(imageUrl);
    }

    // 문서 조회 모드: also capture the PDF page being viewed so the model can
    // talk about it. Hidden (perception) turns skip it for the same reason
    // they skip the camera frame.
    const docImage =
      docMode && !payload.hidden
        ? ((await docViewerRef.current?.capturePage()) ?? undefined)
        : undefined;
    let docUrl: string | undefined;
    if (docImage) {
      docUrl = URL.createObjectURL(docImage);
      objectUrls.current.add(docUrl);
    }

    // Text input: the user message is known now (audio: added on the stt event).
    if (!payload.hidden && payload.text && payload.text.length > 0) {
      const text = payload.text;
      setItems((prev) =>
        addBubble(prev, { id: userId, role: "user", text, imageUrl, docUrl }),
      );
    }

    try {
      // `hidden` is client-only — don't leak it into the request.
      const handle = await startChat({
        text: payload.text,
        audio: payload.audio,
        image,
        document: docImage,
      });

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
        endTurn();
        // Don't clear speakingId here: any TTS already buffered keeps playing,
        // so leave the stop button up (the drain effect hides it once the audio
        // finishes) rather than removing the only control while it's audible.
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
                    docUrl,
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
              if (
                audioSupported &&
                handle.config.audio.encoding === "PCM" &&
                stoppedTurnRef.current !== aiId
              ) {
                player.appendPcm(base64ToArrayBuffer(ev.audio));
                setSpeakingId(aiId);
              }
              return;
            case "done":
              player.finish();
              endTurn();
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
      endTurn();
      const message = e instanceof Error ? e.message : "request failed";
      setItems((prev) =>
        addBubble(prev, { id: aiId, role: "ai", text: "", error: message }),
      );
    }
  };

  // One tick of one perception check. Kept in a ref and reassigned every render
  // so the timer below always calls the current closure (fresh `send`) without
  // being torn down and restarted.
  const perceptionTickRef = useRef<
    ((check: PerceptionCheckInfo) => Promise<void>) | null
  >(null);
  perceptionTickRef.current = async (check) => {
    // Never poll while a turn is in flight (the avatar is mid-sentence) or the
    // tab is hidden: both would waste calls, and a nudge must not interleave
    // with the user's own turn. Disarmed means some check already spoke and is
    // waiting on the user, so skip the call entirely rather than paying for a
    // verdict nothing may act on.
    if (turnInFlight.current || document.hidden || !perceptionArmed.current)
      return;
    // One check at a time, whichever check that is (see perceptionTicking).
    if (perceptionTicking.current) return;
    perceptionTicking.current = true;
    try {
      const frame = await captureFrame(
        check.frameMaxPx,
        check.frameQuality,
      ).catch(() => null);
      if (!frame) return;
      const verdict = await runPerceptionCheck(check.name, frame);
      // Re-check: a turn may have started, another check may have spoken, or
      // the camera may have gone off while the request was in flight.
      if (!verdict || turnInFlight.current || !perceptionArmed.current) return;

      const prev = perceptionState.current.get(check.name);
      const count = prev?.label === verdict.label ? prev.count + 1 : 1;
      perceptionState.current.set(check.name, { label: verdict.label, count });
      if (verdict.signal && count >= check.consecutive) {
        // Disarm synchronously, before send() yields: from here on every other
        // check bails at the guard above, so only this one nudge goes out.
        perceptionArmed.current = false;
        void send({ text: verdict.signal, hidden: true });
      }
    } finally {
      perceptionTicking.current = false;
    }
  };

  // Poll each check on its own interval while the camera is on. The checks are
  // independent here, but they share one arm, so together they still nudge at
  // most once (see perceptionArmed / the tick above).
  useEffect(() => {
    if (!cameraOn || perceptionChecks.length === 0) return;
    perceptionArmed.current = true;
    perceptionState.current.clear();
    const timers = perceptionChecks.map((check) =>
      window.setInterval(() => {
        void perceptionTickRef.current?.(check);
      }, check.intervalMs),
    );
    return () => {
      for (const t of timers) window.clearInterval(t);
      // Start clean next time the camera comes on — and stay disarmed until
      // then, so a verdict still in flight can't nudge with the camera off.
      perceptionArmed.current = false;
      perceptionState.current.clear();
    };
  }, [cameraOn, perceptionChecks]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    // turnInFlight, not `busy`: if a perception nudge grabbed the turn a moment
    // ago the button may not be disabled yet, and send() would drop this text
    // after the input had already been cleared.
    if (!text || turnInFlight.current) return;
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

  const selectAvatar = (url: string) => {
    setAvatarOpen(false);
    if (url === avatar) return;
    setAvatar(url);
    storeAvatar(url);
  };

  // Fit the preview inside PREVIEW_MAX_W x PREVIEW_MAX_H, keeping the real ratio:
  // width-bound for wide streams, height-bound (narrower) for tall ones.
  const previewRatio = previewAspect ?? 16 / 9;
  const previewW = Math.round(
    Math.min(PREVIEW_MAX_W, PREVIEW_MAX_H * previewRatio),
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-zinc-950">
      {/* 문서 조회 모드: PDF viewer pane left of the avatar (PC landscape only).
          Kept mounted while the mode is off so the opened PDF and its page
          survive toggling the mode; capture is gated on docMode in send(). */}
      <div
        className={
          docMode ? "min-w-0 flex-[3] border-r border-white/10" : "hidden"
        }
      >
        <DocViewer ref={docViewerRef} />
      </div>

      {/* Avatar area — the whole viewport normally, the right pane in doc mode.
          All overlays (bubbles, input, previews, modals) live inside it. */}
      <div className="relative h-full min-w-0 flex-[2] overflow-hidden bg-[radial-gradient(ellipse_at_center,_hsl(222_47%_13%)_0%,_hsl(222_84%_5%)_70%)]">
        {/* 3D avatar fills the viewport (mounted once the manifest resolves) */}
        <div className="absolute inset-0">
          {avatar && (
            <Avatar
              ref={avatarRef}
              avatarUrl={avatar}
              getMouthLevel={() => playerRef.current.getLevel()}
              onStatus={(status, message) => {
                setAvatarStatus(status);
                setAvatarError(message ?? null);
              }}
            />
          )}
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
                  {(b.docUrl || b.imageUrl) && (
                    <div className="mb-1.5 flex flex-wrap items-center justify-center gap-1.5">
                      {b.docUrl && (
                        <img
                          src={b.docUrl}
                          alt="첨부한 문서 화면"
                          className="block max-h-24 w-auto max-w-full rounded-lg"
                        />
                      )}
                      {b.imageUrl && (
                        <img
                          src={b.imageUrl}
                          alt="첨부한 카메라 이미지"
                          className="block max-h-24 w-auto max-w-full rounded-lg object-cover"
                        />
                      )}
                    </div>
                  )}
                  {b.text.length > 0 && (
                    <p className="whitespace-pre-wrap break-words">{b.text}</p>
                  )}
                </div>
              ) : (
                <div className="flex max-w-[80%] flex-col items-start gap-1">
                  <div className="rounded-2xl rounded-bl-sm border border-white/15 bg-black/40 px-4 py-2 text-sm leading-relaxed text-white shadow-lg backdrop-blur">
                    {b.text.length > 0 && (
                      <p className="whitespace-pre-wrap break-words">{b.text}</p>
                    )}
                    {b.error && (
                      <p className="mt-1 text-xs text-destructive">{b.error}</p>
                    )}
                  </div>
                  {speakingId === b.id && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => stopSpeaking(b.id)}
                      title="음성 중지"
                      aria-label="음성 중지"
                      className="pointer-events-auto h-8 gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 text-xs text-white shadow-lg backdrop-blur hover:bg-black/70 hover:text-white"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      중지
                    </Button>
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
            {/* Order: 문서(doc viewer) - 음성(mic) - 카메라(camera) - 파일(upload) - ...(more). */}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title={docMode ? "문서 조회 모드 끄기" : "문서 조회 모드"}
              className={
                docMode
                  ? "h-16 w-16 shrink-0 rounded-full bg-white text-black shadow-lg shadow-black/30 hover:bg-white/90 hover:text-black"
                  : "h-16 w-16 shrink-0 rounded-full border border-white/15 bg-black/40 text-white shadow-lg shadow-black/30 backdrop-blur hover:bg-black/55 hover:text-white"
              }
              onClick={() => setDocMode((v) => !v)}
            >
              <BookOpen className="h-6 w-6" />
            </Button>
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
                title="아바타 선택"
                className="h-11 w-11 shrink-0"
                onClick={() => setAvatarOpen(true)}
              >
                <UserRound className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="제스처"
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

        {/* Avatar picker modal — renders public/avatars.json (lib/avatars.ts) */}
        {avatarOpen && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            onClick={() => setAvatarOpen(false)}
          >
            <div
              className="relative w-full max-w-xs rounded-2xl border border-white/10 bg-zinc-900/95 p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setAvatarOpen(false)}
                className="absolute right-3 top-3 text-white/50 transition-colors hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
              <h2 className="mb-4 text-base font-semibold text-white">아바타</h2>
              <div className="flex flex-col gap-2">
                {avatars.map((url) => {
                  const selected = url === avatar;
                  return (
                    <Button
                      key={url}
                      type="button"
                      variant={selected ? "default" : "secondary"}
                      className="h-12 justify-start gap-3 text-sm"
                      onClick={() => selectAvatar(url)}
                    >
                      {selected ? (
                        <Check className="h-5 w-5 shrink-0" />
                      ) : (
                        <UserRound className="h-5 w-5 shrink-0" />
                      )}
                      <span className="truncate">{avatarLabel(url)}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
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
    </div>
  );
}
