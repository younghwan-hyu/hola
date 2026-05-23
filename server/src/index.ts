import cors from "cors";
import express from "express";

import { createAiProvider } from "./ai/index.ts";
import { config } from "./config.ts";
import { createChatRouter } from "./routes/chat.ts";
import { createSttProvider } from "./stt/index.ts";
import { createTtsProvider } from "./tts/index.ts";

const stt = createSttProvider(config.stt);
const ai = createAiProvider(config.ai, {
  openaiKey: config.openaiKey,
  anthropicKey: config.anthropicKey,
});
const tts = createTtsProvider(config.tts);

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

app.use("/api", createChatRouter({ config, stt, ai, tts }));

app.listen(config.port, () => {
  console.log(`[hola] listening on :${config.port}`);
  console.log(
    `[hola] stt=${config.stt.provider}/${config.stt.model} ai=${config.ai.provider}/${config.ai.model} tts=${config.tts.provider}/${config.tts.voice}`,
  );
});
