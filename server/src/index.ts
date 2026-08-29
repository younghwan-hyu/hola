import cors from "cors";
import express from "express";

import { createAiProvider } from "./ai/index.ts";
import { config } from "./config.ts";
import { createEmbeddingsProvider } from "./embeddings/index.ts";
import {
  createPerceptionChecks,
  withPerceptionGuidance,
} from "./perception/index.ts";
import { createChatRouter } from "./routes/chat.ts";
import { createDocumentsRouter } from "./routes/documents.ts";
import { createPerceptionRouter } from "./routes/perception.ts";
import { createPool, initDb } from "./rag/db.ts";
import { createRagStore } from "./rag/store.ts";
import { createSttProvider } from "./stt/index.ts";
import { createTools } from "./tools/index.ts";
import { createTtsProvider } from "./tts/index.ts";

const stt = createSttProvider(config.stt);
const tts = createTtsProvider(config.tts);

// RAG: self-hosted embeddings + pgvector store. The search_documents tool reads
// from this store, so it must be built before the AI provider gets its tools.
const embeddings = createEmbeddingsProvider(config.rag);
const pool = createPool(config.rag.databaseUrl);
const ragStore = createRagStore({ pool, embeddings, config: config.rag });

const tools = createTools({ ragStore, ragTopK: config.rag.topK });

// Perception checks are one-shot looks at a camera frame, polled by the browser
// while the camera is on and run OUTSIDE the conversation session. Each check
// carries the system-prompt rule for its own signals, so they're folded into the
// prompt before the provider is built (see perception/index.ts).
const perceptionChecks = createPerceptionChecks();
const ai = createAiProvider(
  {
    ...config.ai,
    systemPrompt: withPerceptionGuidance(
      config.ai.systemPrompt,
      perceptionChecks,
    ),
  },
  { openaiKey: config.openaiKey, anthropicKey: config.anthropicKey },
  tools,
);

// Issue one conversation session at startup; every AI call reuses it so the
// avatar keeps context across turns for the server's lifetime.
const aiSession = ai.createSession();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    stt: { provider: config.stt.provider, model: config.stt.model },
    ai: { provider: config.ai.provider, model: config.ai.model },
    tts: { provider: config.tts.provider, voice: config.tts.voice },
    rag: {
      provider: config.rag.embeddingsProvider,
      model: config.rag.embeddingsModel,
      dim: config.rag.embeddingDim,
    },
    perception: perceptionChecks.map((c) => c.name),
  });
});

app.use("/api", createChatRouter({ config, stt, ai, aiSession, tts }));
app.use("/api", createDocumentsRouter({ ragStore }));
app.use("/api", createPerceptionRouter({ checks: perceptionChecks, ai }));

// Ensure the pgvector schema exists before serving so the first upload never
// races schema creation. Non-fatal: if the DB is unreachable the base voice
// pipeline still works and RAG endpoints error until the DB comes up.
try {
  await initDb(pool, {
    model: config.rag.embeddingsModel,
    dim: config.rag.embeddingDim,
  });
  console.log("[hola] rag-db schema ready");
} catch (e) {
  console.warn(
    `[hola] rag-db init failed (RAG disabled until DB is up): ${e instanceof Error ? e.message : String(e)}`,
  );
}

app.listen(config.port, () => {
  console.log(`[hola] listening on :${config.port}`);
  console.log(
    `[hola] stt=${config.stt.provider}/${config.stt.model} ai=${config.ai.provider}/${config.ai.model} tts=${config.tts.provider}/${config.tts.voice}`,
  );
  console.log(`[hola] tools=[${tools.map((t) => t.name).join(", ")}]`);
  console.log(
    `[hola] perception=[${perceptionChecks.map((c) => `${c.name}@${c.trigger.intervalMs}ms`).join(", ")}]`,
  );
  console.log(
    `[hola] rag=${config.rag.embeddingsProvider}/${config.rag.embeddingsModel} dim=${config.rag.embeddingDim} db=${config.rag.databaseUrl.replace(/\/\/[^@]*@/, "//***@")}`,
  );
  console.log(`[hola] ai session issued: ${aiSession.key}`);

  // Warm clients in parallel — don't block listen, log per-provider failure.
  // embeddings.warmup triggers the model load (the container pulls it on first
  // boot, so warmup retries with backoff).
  const warmupStart = Date.now();
  const tasks: Array<[string, Promise<void>]> = [
    ["stt", stt.warmup()],
    ["ai", ai.warmup()],
    ["tts", tts.warmup()],
    ["embeddings", embeddings.warmup()],
  ];
  void Promise.all(
    tasks.map(async ([name, p]) => {
      const t0 = Date.now();
      try {
        await p;
        console.log(`[hola] warmup ${name} ok (${Date.now() - t0}ms)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[hola] warmup ${name} failed: ${msg}`);
      }
    }),
  ).then(() => {
    console.log(`[hola] warmup total ${Date.now() - warmupStart}ms`);
  });
});
