import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Props {
  disabled?: boolean;
  onCaptured: (blob: Blob) => void;
  /** "lg" renders a large round hero mic (primary voice input); default is the bar-sized button. */
  size?: "default" | "lg";
}

function pickMimeType(): string | "" {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus"))
    return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus"))
    return "audio/ogg;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "";
}

export function Recorder({ disabled, onCaptured, size = "default" }: Props) {
  const isLg = size === "lg";
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      const rec = recRef.current;
      if (rec && rec.state === "recording") {
        rec.stop();
      }
    };
  }, []);

  const start = async () => {
    // navigator.mediaDevices exists only in a secure context (HTTPS/localhost);
    // over plain http (e.g. a phone on the LAN dev server) it is undefined.
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        window.isSecureContext
          ? "이 브라우저에서는 마이크를 사용할 수 없습니다."
          : "마이크는 HTTPS/localhost 접속에서만 사용할 수 있습니다 (현재 http 접속).",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMimeType();
      const rec = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      recRef.current = rec;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        for (const track of stream.getTracks()) track.stop();
        const blob = new Blob(chunksRef.current, {
          type: mime || "audio/webm",
        });
        onCaptured(blob);
      };
      rec.start();
      setRecording(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "microphone unavailable");
    }
  };

  const stop = () => {
    recRef.current?.stop();
    setRecording(false);
  };

  return (
    <div
      className={
        isLg
          ? "flex flex-col items-center gap-1"
          : "flex shrink-0 flex-col items-stretch gap-1"
      }
    >
      <Button
        type="button"
        variant={recording ? "destructive" : isLg ? "ghost" : "outline"}
        disabled={disabled && !recording}
        onClick={recording ? stop : start}
        size="icon"
        className={
          isLg
            ? recording
              ? "h-14 w-14 shrink-0 rounded-full sm:h-16 sm:w-16 shadow-lg shadow-black/30 ring-4 ring-destructive/40"
              : "h-14 w-14 shrink-0 rounded-full sm:h-16 sm:w-16 border border-white/15 bg-black/40 text-white shadow-lg shadow-black/30 backdrop-blur hover:bg-black/55 hover:text-white"
            : "h-11 w-11 shrink-0"
        }
      >
        {recording ? (
          <Square className={isLg ? "h-6 w-6" : "h-4 w-4"} />
        ) : (
          <Mic className={isLg ? "h-6 w-6" : "h-4 w-4"} />
        )}
      </Button>
      {error && (
        <p
          className={`text-[10px] leading-tight text-destructive ${
            isLg ? "max-w-[160px] text-center" : "max-w-[80px]"
          }`}
        >
          {error}
        </p>
      )}
    </div>
  );
}
