import type { RagStore } from "../rag/store.ts";
import type { Tool } from "./types.ts";

/** Cap on returned chunk text so tool results don't bloat the conversation history. */
const MAX_CONTENT_CHARS = 1000;

interface SearchInput {
  query?: unknown;
  top_k?: unknown;
}

/**
 * Semantic search over user-uploaded documents (pgvector cosine). Returns a JSON
 * string of the best-matching chunks. Input-validation problems come back as a
 * JSON `{error}`; store/embedding failures throw and are caught by callTool(),
 * which surfaces them to the model as a string (so the turn keeps going).
 */
export function createSearchDocumentsTool(deps: {
  ragStore: RagStore;
  defaultTopK: number;
}): Tool {
  return {
    name: "search_documents",
    description:
      "사용자가 업로드한 문서에서 질문과 의미가 비슷한 내용을 검색한다. 문서에 있을 법한 사실, 정의, 수치, 고유명사를 물어볼 때 사용하라. 결과는 관련 청크들의 목록이다.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "검색할 자연어 질의. 사용자의 질문을 그대로 또는 핵심어로 입력한다.",
        },
        top_k: {
          type: "integer",
          description: "가져올 청크 개수 (기본값 사용 권장, 최대 10).",
          minimum: 1,
          maximum: 10,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    async execute(input: unknown): Promise<string> {
      const { query, top_k } = (input ?? {}) as SearchInput;
      if (typeof query !== "string" || query.trim().length === 0) {
        return JSON.stringify({ error: "query is required" });
      }
      const topK =
        typeof top_k === "number" && Number.isFinite(top_k)
          ? Math.min(Math.max(1, Math.floor(top_k)), 10)
          : deps.defaultTopK;

      const hits = await deps.ragStore.search(query, topK);
      if (hits.length === 0) {
        return JSON.stringify({
          results: [],
          note: "no matching documents; answer that you don't have that information",
        });
      }
      return JSON.stringify({
        results: hits.map((h) => ({
          filename: h.filename,
          chunk_index: h.chunkIndex,
          score: Number(h.score.toFixed(4)),
          content:
            h.content.length > MAX_CONTENT_CHARS
              ? h.content.slice(0, MAX_CONTENT_CHARS) + "…"
              : h.content,
        })),
      });
    },
  };
}
