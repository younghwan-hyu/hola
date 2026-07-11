import { Router } from "express";
import multer from "multer";

import type { RagStore } from "../rag/store.ts";

interface Deps {
  ragStore: RagStore;
}

/** Accept only plain-text uploads. */
const ALLOWED_EXT = /\.(txt|md|markdown|text)$/i;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksBinary(text: string): boolean {
  // A NUL char means this wasn't text; many U+FFFD replacement chars mean the
  // bytes weren't valid UTF-8 (e.g. an image or a non-UTF-8 encoding).
  if (text.indexOf("\u0000") !== -1) return true;
  let replacements = 0;
  for (const ch of text) if (ch === "�") replacements++;
  return replacements > Math.max(3, text.length * 0.02);
}

export function createDocumentsRouter(deps: Deps): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 1 * 1024 * 1024 }, // 1MB cap on text uploads.
  });

  router.post("/documents", upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "`file` is required" });
      return;
    }
    const isTextMime =
      file.mimetype.startsWith("text/") ||
      file.mimetype === "application/octet-stream" ||
      file.mimetype === "";
    if (!ALLOWED_EXT.test(file.originalname) && !isTextMime) {
      res
        .status(400)
        .json({ error: "only text files (.txt, .md) are supported" });
      return;
    }

    // Decode UTF-8, stripping a BOM if present.
    let text = file.buffer.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (text.trim().length === 0) {
      res.status(400).json({ error: "file is empty" });
      return;
    }
    if (looksBinary(text)) {
      res.status(400).json({ error: "file does not look like UTF-8 text" });
      return;
    }

    // Multer preserves the raw filename bytes as latin1; recover UTF-8.
    const filename = Buffer.from(file.originalname, "latin1").toString("utf8");

    try {
      const result = await deps.ragStore.ingest({ filename, text });
      res.status(result.skipped ? 200 : 201).json({
        document_id: result.documentId,
        filename: result.filename,
        chunks: result.chunks,
        skipped: result.skipped,
      });
    } catch (err) {
      // Keep the detail in the server log; return a generic message to the client.
      console.error(
        `[hola] document ingest failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      res.status(500).json({ error: "document ingest failed" });
    }
  });

  router.get("/documents", async (_req, res) => {
    try {
      res.json(await deps.ragStore.list());
    } catch (err) {
      console.error(
        `[hola] list documents failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      res.status(500).json({ error: "failed to list documents" });
    }
  });

  router.delete("/documents/:id", async (req, res) => {
    if (!UUID_RE.test(req.params.id)) {
      res.status(404).json({ error: "document not found" });
      return;
    }
    try {
      const removed = await deps.ragStore.remove(req.params.id);
      if (!removed) {
        res.status(404).json({ error: "document not found" });
        return;
      }
      res.status(204).end();
    } catch (err) {
      console.error(
        `[hola] delete document failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      res.status(500).json({ error: "failed to delete document" });
    }
  });

  return router;
}
