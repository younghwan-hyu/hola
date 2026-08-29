import { Router } from "express";
import multer from "multer";

import type { Config } from "../config.ts";
import type { AiProvider, AiSession } from "../ai/index.ts";
import type { VoiceCheck, VoiceFeatures } from "../perception/index.ts";
import type { SttProvider } from "../stt/index.ts";
import type { TtsProvider } from "../tts/index.ts";
import { runPipeline } from "../pipeline/pipeline.ts";
import { SessionRegistry } from "../pipeline/session.ts";
import { imageProblem } from "../util/image.ts";
import { attachSse } from "../util/sse.ts";

interface Deps {
  config: Config;
  stt: SttProvider;
  ai: AiProvider;
  aiSession: AiSession;
  tts: TtsProvider;
  /** Turn-driven voice checks, run on spoken turns (perception/voice.ts). */
  voiceChecks: readonly VoiceCheck[];
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB cap on camera frames.

/** Comma-separated check names -> list (the `perception` form field). */
function parseNames(raw: unknown): string[] {
  return typeof raw === "string"
    ? raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];
}

/**
 * The browser's tone measurements (the `voice` form field, JSON). Anything
 * malformed is treated as "no measurements" rather than a 400: the turn is
 * still a perfectly good chat turn, the voice check just gets less to go on.
 */
function parseVoiceFeatures(raw: unknown): VoiceFeatures | undefined {
  if (typeof raw !== "string") return undefined;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const num = (x: unknown): x is number =>
    typeof x === "number" && Number.isFinite(x);
  const hz = (x: unknown): number | null | undefined =>
    x === null ? null : num(x) ? x : undefined;
  const f0MeanHz = hz(o.f0MeanHz);
  const f0StdHz = hz(o.f0StdHz);
  if (
    !num(o.durationSec) ||
    !num(o.speechSec) ||
    !num(o.rmsMean) ||
    !num(o.voicedRatio) ||
    f0MeanHz === undefined ||
    f0StdHz === undefined
  )
    return undefined;
  return {
    durationSec: o.durationSec,
    speechSec: o.speechSec,
    rmsMean: o.rmsMean,
    voicedRatio: o.voicedRatio,
    f0MeanHz,
    f0StdHz,
  };
}

export function createChatRouter(deps: Deps): Router {
  const router = Router();
  const registry = new SessionRegistry();
  const enabledGestures: ReadonlySet<string> = new Set(deps.config.gestures);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB cap on uploads.
  });

  router.post(
    "/chat",
    upload.fields([
      { name: "audio", maxCount: 1 },
      { name: "image", maxCount: 1 },
      { name: "document", maxCount: 1 },
    ]),
    (req, res) => {
      const text =
        typeof req.body?.text === "string" ? req.body.text : undefined;
      const files = req.files as
        | Record<string, Express.Multer.File[]>
        | undefined;
      const file = files?.audio?.[0];
      const image = files?.image?.[0];
      // Doc-viewer mode: a capture of the PDF page the user is looking at.
      const docImage = files?.document?.[0];
      // Spoken turns may carry the browser's tone measurements and the names of
      // the voice checks the user has switched on (see perception/voice.ts).
      const voice = file
        ? {
            features: parseVoiceFeatures(req.body?.voice),
            checks: parseNames(req.body?.perception),
          }
        : undefined;

      if (!text && !file) {
        res.status(400).json({ error: "either `text` or `audio` is required" });
        return;
      }

      // Both capture parts (camera frame, doc-viewer page) are images.
      for (const capture of [image, docImage]) {
        if (capture) {
          const problem = imageProblem(capture, MAX_IMAGE_BYTES);
          if (problem) {
            res.status(400).json({ error: problem });
            return;
          }
        }
      }

      const session = registry.create();
      res.status(202).json({
        session_id: session.id,
        config: {
          stt: deps.config.stt,
          ai: {
            provider: deps.config.ai.provider,
            model: deps.config.ai.model,
          },
          tts: deps.config.tts,
          audio: {
            encoding: deps.config.tts.audioEncoding,
            sampleRateHertz: deps.config.tts.sampleRateHertz,
            channels: 1,
            bitsPerSample: 16,
          },
        },
      });

      void runPipeline(
        session,
        {
          text,
          audio: file
            ? { bytes: file.buffer, mimeType: file.mimetype }
            : undefined,
          image: image
            ? { bytes: image.buffer, mimeType: image.mimetype }
            : undefined,
          document: docImage
            ? { bytes: docImage.buffer, mimeType: docImage.mimetype }
            : undefined,
          voice,
        },
        {
          stt: deps.stt,
          ai: deps.ai,
          aiSession: deps.aiSession,
          tts: deps.tts,
          sentenceBoundaryChars: deps.config.sentenceBoundaryChars,
          enabledGestures,
          voiceChecks: deps.voiceChecks,
        },
      );
    },
  );

  router.get("/chat/:id", (req, res) => {
    const session = registry.take(req.params.id);
    if (!session) {
      res.status(404).json({ error: "session not found or already consumed" });
      return;
    }
    const sse = attachSse(res);
    session.subscribe(sse);
  });

  return router;
}
