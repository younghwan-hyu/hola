import { Router } from "express";
import multer from "multer";

import type { Config } from "../config.ts";
import type { AiProvider, AiSession } from "../ai/index.ts";
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
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB cap on camera frames.

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
        },
        {
          stt: deps.stt,
          ai: deps.ai,
          aiSession: deps.aiSession,
          tts: deps.tts,
          sentenceBoundaryChars: deps.config.sentenceBoundaryChars,
          enabledGestures,
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
