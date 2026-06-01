import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Props {
  disabled?: boolean;
  onCaptured: (blob: Blob) => void;
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

export function Recorder({ disabled, onCaptured }: Props) {
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
    <div className="flex shrink-0 flex-col items-stretch gap-1">
      <Button
        type="button"
        variant={recording ? "destructive" : "outline"}
        disabled={disabled && !recording}
        onClick={recording ? stop : start}
        size="icon"
        className="h-11 w-11 shrink-0"
        title={recording ? "Stop recording" : "Record"}
      >
        {recording ? (
          <Square className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </Button>
      {error && (
        <p className="text-[10px] leading-tight text-destructive max-w-[80px]">
          {error}
        </p>
      )}
    </div>
  );
}
