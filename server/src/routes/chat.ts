import { Router } from "express";
import multer from "multer";

import type { Config } from "../config.ts";
import type { AiProvider, AiSession } from "../ai/index.ts";
import type { SttProvider } from "../stt/index.ts";
import type { TtsProvider } from "../tts/index.ts";
import { runPipeline } from "../pipeline/pipeline.ts";
import { SessionRegistry } from "../pipeline/session.ts";
import { attachSse } from "../util/sse.ts";

interface Deps {
  config: Config;
  stt: SttProvider;
  ai: AiProvider;
  aiSession: AiSession;
  tts: TtsProvider;
}

export function createChatRouter(deps: Deps): Router {
  const router = Router();
  const registry = new SessionRegistry();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB cap on audio uploads.
  });

  router.post("/chat", upload.single("audio"), (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text : undefined;
    const file = req.file;

    if (!text && !file) {
      res.status(400).json({ error: "either `text` or `audio` is required" });
      return;
    }

    const session = registry.create();
    res.status(202).json({
      session_id: session.id,
      config: {
        stt: deps.config.stt,
        ai: { provider: deps.config.ai.provider, model: deps.config.ai.model },
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
      },
      {
        stt: deps.stt,
        ai: deps.ai,
        aiSession: deps.aiSession,
        tts: deps.tts,
        sentenceBoundaryChars: deps.config.sentenceBoundaryChars,
      },
    );
  });

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
