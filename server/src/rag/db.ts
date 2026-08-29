import { Pool } from "pg";

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

async function createChunksTable(pool: Pool, dim: number): Promise<void> {
  // `dim` is a validated integer from config (not user input), so interpolating
  // it into the type is safe. pgvector fixes the column dimension at DDL time.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chunks (
      id          bigserial PRIMARY KEY,
      document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index integer NOT NULL,
      content     text NOT NULL,
      embedding   vector(${dim}) NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chunks_embedding_idx
      ON chunks USING hnsw (embedding vector_cosine_ops)
  `);
}

/** Actual declared dimension of chunks.embedding, or null if the table/column is absent. */
async function currentColumnDim(pool: Pool): Promise<number | null> {
  const { rows } = await pool.query<{ dim: number }>(
    `SELECT a.atttypmod AS dim
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'chunks'
       AND a.attname = 'embedding'
       AND NOT a.attisdropped`,
  );
  // pgvector stores the dimension directly in atttypmod; -1 means unspecified.
  const dim = rows[0]?.dim;
  return dim === undefined || dim < 0 ? null : dim;
}

async function hasChunks(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM chunks`,
  );
  return (rows[0]?.n ?? "0") !== "0";
}

async function writeMeta(
  pool: Pool,
  meta: { model: string; dim: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO rag_meta (key, value) VALUES ('embedding_model', $1), ('embedding_dim', $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [meta.model, String(meta.dim)],
  );
}

/**
 * Create the pgvector extension, tables and index if absent, then reconcile the
 * embedding model/dimension with what the store was built for. The ingest model
 * MUST match the query model (and the physical column dimension MUST match the
 * configured dimension) or search silently degrades / inserts fail — so this
 * function keeps the physical schema and `rag_meta` in agreement:
 *
 * - dimension changed, store empty  -> drop & recreate the chunks table at the
 *   new dimension (safe, no data lost), and record the new model/dim.
 * - dimension changed, store has data -> refuse: log loudly and leave the schema
 *   and meta untouched. Uploads AND search fail until the operator reverts
 *   EMBEDDING_DIM or wipes the `pgdata` volume: the embeddings provider rejects
 *   vectors that don't match the configured dim, and a vector that does match
 *   it can't be inserted into (or compared against) the old-dim column.
 * - model changed (same dim), store has data -> log loudly; existing vectors are
 *   from the old model and won't match new queries. Re-upload or wipe.
 */
export async function initDb(
  pool: Pool,
  meta: { model: string; dim: number },
): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS rag_meta (
      key   text PRIMARY KEY,
      value text NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id           uuid PRIMARY KEY,
      filename     text NOT NULL UNIQUE,
      content_hash text NOT NULL,
      byte_size    integer NOT NULL,
      chunk_count  integer NOT NULL,
      uploaded_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  const actualDim = await currentColumnDim(pool);

  if (actualDim === null) {
    // Fresh store (or chunks table missing): create at the configured dimension.
    await createChunksTable(pool, meta.dim);
  } else if (actualDim !== meta.dim) {
    if (await hasChunks(pool)) {
      console.error(
        `[hola] RAG embedding dimension changed (column=vector(${actualDim}), configured=${meta.dim}) ` +
          `while chunks exist. Uploads/search will fail. Revert EMBEDDING_DIM to ${actualDim}, ` +
          `or wipe the pgdata volume (docker compose down -v) and re-upload.`,
      );
      return; // leave schema + meta untouched; do not falsely report success
    }
    console.warn(
      `[hola] RAG embedding dimension changed on an empty store (vector(${actualDim}) -> vector(${meta.dim})); recreating chunks table`,
    );
    await pool.query(`DROP TABLE IF EXISTS chunks`);
    await createChunksTable(pool, meta.dim);
  } else {
    // Dimension matches; make sure the index exists (e.g. created before it was added).
    await pool.query(`
      CREATE INDEX IF NOT EXISTS chunks_embedding_idx
        ON chunks USING hnsw (embedding vector_cosine_ops)
    `);
  }

  // Reconcile the recorded model/dim.
  const { rows } = await pool.query<{ key: string; value: string }>(
    `SELECT key, value FROM rag_meta WHERE key IN ('embedding_model', 'embedding_dim')`,
  );
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const storedModel = stored.get("embedding_model");
  const storedDim = stored.get("embedding_dim");

  if (storedModel === undefined) {
    await writeMeta(pool, meta);
    return;
  }
  if (storedModel === meta.model && storedDim === String(meta.dim)) {
    return; // in sync
  }
  // Model/dim changed. If data survived a same-dim model swap, warn (vectors are
  // from the old model). If we got here after recreating an empty store, it's safe.
  if (await hasChunks(pool)) {
    console.error(
      `[hola] RAG embedding model changed (stored=${storedModel}/${storedDim}, configured=${meta.model}/${meta.dim}) ` +
        `while chunks exist. Existing vectors won't match new queries — re-upload documents, ` +
        `or wipe the pgdata volume.`,
    );
    return;
  }
  await writeMeta(pool, meta);
}
