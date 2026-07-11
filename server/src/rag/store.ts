import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { RagConfig } from "../config.ts";
import type { EmbeddingsProvider } from "../embeddings/index.ts";
import { chunkText } from "./chunker.ts";

export interface IngestResult {
  documentId: string;
  filename: string;
  chunks: number;
  /** true when an identical document (same content hash) already existed. */
  skipped: boolean;
}

export interface DocumentInfo {
  id: string;
  filename: string;
  chunkCount: number;
  uploadedAt: string;
}

export interface SearchHit {
  filename: string;
  chunkIndex: number;
  score: number;
  content: string;
}

export interface RagStore {
  ingest(input: { filename: string; text: string }): Promise<IngestResult>;
  search(query: string, topK: number): Promise<SearchHit[]>;
  list(): Promise<DocumentInfo[]>;
  remove(id: string): Promise<boolean>;
}

/** pgvector literal: `[0.1,0.2,...]`. */
function toVectorLiteral(vec: number[]): string {
  return `[${vec.map((x) => (Number.isFinite(x) ? x : 0)).join(",")}]`;
}

export function createRagStore(deps: {
  pool: Pool;
  embeddings: EmbeddingsProvider;
  config: RagConfig;
}): RagStore {
  const { pool, embeddings, config } = deps;

  return {
    async ingest({ filename, text }): Promise<IngestResult> {
      const contentHash = createHash("sha256").update(text, "utf8").digest("hex");
      const byteSize = Buffer.byteLength(text, "utf8");

      // Each filename maps to one document. Fast path: re-uploading the same
      // filename with unchanged content is a no-op (skip re-embedding).
      const pre = await pool.query<{
        id: string;
        content_hash: string;
        chunk_count: number;
      }>(
        `SELECT id, content_hash, chunk_count FROM documents WHERE filename = $1`,
        [filename],
      );
      const preRow = pre.rows[0];
      if (preRow && preRow.content_hash === contentHash) {
        return {
          documentId: preRow.id,
          filename,
          chunks: preRow.chunk_count,
          skipped: true,
        };
      }

      const pieces = chunkText(text, {
        maxChars: config.chunkSize,
        overlap: config.chunkOverlap,
      });
      if (pieces.length === 0) {
        throw new Error("document has no textual content after chunking");
      }
      const vectors = await embeddings.embed(pieces);
      if (vectors.length !== pieces.length) {
        throw new Error(
          `embedding count ${vectors.length} != chunk count ${pieces.length}`,
        );
      }

      const documentId = randomUUID();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serialize concurrent ingests of the same filename so the delete+insert
        // below can't interleave into duplicate rows / a UNIQUE(filename) clash.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          filename,
        ]);
        // Authoritative re-check under the lock (another upload may have won).
        const cur = await client.query<{
          id: string;
          content_hash: string;
          chunk_count: number;
        }>(
          `SELECT id, content_hash, chunk_count FROM documents WHERE filename = $1`,
          [filename],
        );
        const curRow = cur.rows[0];
        if (curRow && curRow.content_hash === contentHash) {
          await client.query("COMMIT");
          return {
            documentId: curRow.id,
            filename,
            chunks: curRow.chunk_count,
            skipped: true,
          };
        }
        // Replace any prior document for this filename (cascade drops its chunks).
        if (curRow) {
          await client.query(`DELETE FROM documents WHERE id = $1`, [curRow.id]);
        }
        await client.query(
          `INSERT INTO documents (id, filename, content_hash, byte_size, chunk_count)
           VALUES ($1, $2, $3, $4, $5)`,
          [documentId, filename, contentHash, byteSize, pieces.length],
        );
        for (let i = 0; i < pieces.length; i++) {
          await client.query(
            `INSERT INTO chunks (document_id, chunk_index, content, embedding)
             VALUES ($1, $2, $3, $4::vector)`,
            [documentId, i, pieces[i], toVectorLiteral(vectors[i] as number[])],
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      return {
        documentId,
        filename,
        chunks: pieces.length,
        skipped: false,
      };
    },

    async search(query: string, topK: number): Promise<SearchHit[]> {
      const q = query.trim();
      if (q.length === 0) return [];
      const limit = Math.min(Math.max(1, Math.floor(topK)), 20);
      const [vector] = await embeddings.embed([q]);
      if (!vector) return [];
      const { rows } = await pool.query<{
        filename: string;
        chunk_index: number;
        score: number;
        content: string;
      }>(
        `SELECT d.filename,
                c.chunk_index,
                1 - (c.embedding <=> $1::vector) AS score,
                c.content
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
         ORDER BY c.embedding <=> $1::vector
         LIMIT $2`,
        [toVectorLiteral(vector), limit],
      );
      return rows.map((r) => ({
        filename: r.filename,
        chunkIndex: r.chunk_index,
        score: Number(r.score),
        content: r.content,
      }));
    },

    async list(): Promise<DocumentInfo[]> {
      const { rows } = await pool.query<{
        id: string;
        filename: string;
        chunk_count: number;
        uploaded_at: Date;
      }>(
        `SELECT id, filename, chunk_count, uploaded_at
         FROM documents ORDER BY uploaded_at DESC`,
      );
      return rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        chunkCount: r.chunk_count,
        uploadedAt:
          r.uploaded_at instanceof Date
            ? r.uploaded_at.toISOString()
            : String(r.uploaded_at),
      }));
    },

    async remove(id: string): Promise<boolean> {
      const res = await pool.query(`DELETE FROM documents WHERE id = $1`, [id]);
      return (res.rowCount ?? 0) > 0;
    },
  };
}
