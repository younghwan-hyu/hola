import cors from "cors";
import express from "express";

import { createAiProvider } from "./ai/index.ts";
import { config } from "./config.ts";
import { createChatRouter } from "./routes/chat.ts";
import { createSttProvider } from "./stt/index.ts";
import { createTools } from "./tools/index.ts";
import { createTtsProvider } from "./tts/index.ts";

const stt = createSttProvider(config.stt);
const tools = createTools();
const ai = createAiProvider(
  config.ai,
  { openaiKey: config.openaiKey, anthropicKey: config.anthropicKey },
  tools,
);
const tts = createTtsProvider(config.tts);

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
  });
});

app.use("/api", createChatRouter({ config, stt, ai, aiSession, tts }));

app.listen(config.port, () => {
  console.log(`[hola] listening on :${config.port}`);
  console.log(
    `[hola] stt=${config.stt.provider}/${config.stt.model} ai=${config.ai.provider}/${config.ai.model} tts=${config.tts.provider}/${config.tts.voice}`,
  );
  console.log(`[hola] tools=[${tools.map((t) => t.name).join(", ")}]`);
  console.log(`[hola] ai session issued: ${aiSession.key}`);

  // Warm clients in parallel — don't block listen, log per-provider failure.
  const warmupStart = Date.now();
  const tasks: Array<[string, Promise<void>]> = [
    ["stt", stt.warmup()],
    ["ai", ai.warmup()],
    ["tts", tts.warmup()],
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
