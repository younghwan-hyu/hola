import type { RagConfig } from "../config.ts";
import type { EmbeddingsProvider } from "./types.ts";

/** Max texts per /api/embed request; keeps individual calls bounded. */
const BATCH_SIZE = 32;

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

/**
 * Self-hosted embeddings via an Ollama server (`POST /api/embed`). No external
 * embedding API is used — the model runs inside the compose `embeddings`
 * service. Batches inputs and validates the returned dimension.
 */
export function createOllamaEmbeddingsProvider(
  cfg: RagConfig,
): EmbeddingsProvider {
  const base = cfg.embeddingsUrl.replace(/\/+$/, "");
  const url = `${base}/api/embed`;

  async function embedBatch(batch: string[]): Promise<number[][]> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.embeddingsModel, input: batch }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `ollama /api/embed ${res.status}: ${body.slice(0, 300)}`,
      );
    }
    const json = (await res.json()) as OllamaEmbedResponse;
    const vectors = json.embeddings;
    if (!Array.isArray(vectors) || vectors.length !== batch.length) {
      throw new Error(
        `ollama /api/embed returned ${vectors?.length ?? 0} vectors for ${batch.length} inputs`,
      );
    }
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length !== cfg.embeddingDim) {
        throw new Error(
          `embedding dim mismatch: model "${cfg.embeddingsModel}" returned ${v?.length ?? 0}, expected ${cfg.embeddingDim} (set EMBEDDING_DIM to match the model)`,
        );
      }
    }
    return vectors;
  }

  return {
    name: "ollama",
    dim: cfg.embeddingDim,
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        out.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE))));
      }
      return out;
    },
    async warmup(): Promise<void> {
      // The embeddings container pulls the model on first boot, so the model may
      // not be ready for a little while. Retry with backoff before giving up.
      const delaysMs = [1000, 2000, 4000, 8000, 15000];
      let lastErr: unknown;
      for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
        try {
          await embedBatch(["워밍업"]);
          return;
        } catch (err) {
          lastErr = err;
          const wait = delaysMs[attempt];
          if (wait === undefined) break;
          await new Promise((r) => setTimeout(r, wait));
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    },
  };
}
