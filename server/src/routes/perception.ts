import { Router } from "express";
import multer from "multer";

import type { AiProvider } from "../ai/index.ts";
import {
  runPerceptionCheck,
  type PerceptionCheck,
  type PerceptionCheckInfo,
} from "../perception/index.ts";
import { imageProblem } from "../util/image.ts";

interface Deps {
  checks: PerceptionCheck[];
  ai: AiProvider;
}

/** Polling frames are downscaled by the client; keep the cap tight. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * Perception checks: `GET` advertises what the client should poll while the
 * camera is on (plus the label/description its 상황 인지 on/off modal shows),
 * `POST` runs one check against a frame. Both are generic over the check
 * registry (`server/src/perception`), so adding a check needs no change here
 * or in the browser.
 */
export function createPerceptionRouter(deps: Deps): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES },
  });

  router.get("/perception", (_req, res) => {
    const info: PerceptionCheckInfo[] = deps.checks.map((check) => ({
      name: check.name,
      label: check.label,
      description: check.description,
      requires: check.requires,
      trigger: check.trigger,
      ...(check.frame ? { frame: check.frame } : {}),
    }));
    res.json(info);
  });

  router.post("/perception/:name", upload.single("image"), async (req, res) => {
    const check = deps.checks.find((c) => c.name === req.params.name);
    if (!check) {
      res
        .status(404)
        .json({ error: `unknown perception check: ${req.params.name}` });
      return;
    }
    const image = req.file;
    if (!image) {
      res.status(400).json({ error: "`image` is required" });
      return;
    }
    const problem = imageProblem(image, MAX_IMAGE_BYTES);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }

    try {
      const verdict = await runPerceptionCheck(
        check,
        { image: { bytes: image.buffer, mimeType: image.mimetype } },
        deps.ai,
      );
      res.json(verdict);
    } catch (e) {
      // The client polls on a timer and ignores failures, so a bad frame or a
      // provider hiccup just means "no verdict this tick".
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[hola] perception ${check.name} failed: ${message}`);
      res.status(502).json({ error: message });
    }
  });

  return router;
}
