import type { RagStore } from "../rag/store.ts";
import { createGetWeatherTool } from "./get-weather.ts";
import { createSearchDocumentsTool } from "./search-documents.ts";
import type { Tool } from "./types.ts";

/** Max AI<->tool round-trips per user turn, guarding against tool loops. */
export const MAX_TOOL_STEPS = 5;

export interface ToolDeps {
  ragStore: RagStore;
  /** Default number of chunks search_documents returns. */
  ragTopK: number;
}

/** The tools exposed to the AI provider. */
export function createTools(deps: ToolDeps): Tool[] {
  return [
    createGetWeatherTool(),
    createSearchDocumentsTool({
      ragStore: deps.ragStore,
      defaultTopK: deps.ragTopK,
    }),
  ];
}

/**
 * Look up a tool by name and execute it. Both failure modes — unknown tool and
 * a throwing/rejecting execute — are returned as a string so the model can
 * recover instead of aborting the whole pipeline.
 */
export async function callTool(
  tools: Map<string, Tool>,
  name: string,
  input: unknown,
): Promise<string> {
  const tool = tools.get(name);
  if (!tool) return `error: unknown tool "${name}"`;
  console.log(`[hola] tool ${name}(${JSON.stringify(input)})`);
  try {
    const result = await tool.execute(input);
    console.log(`[hola] tool ${name} -> ${result.slice(0, 200)}`);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[hola] tool ${name} failed: ${msg}`);
    return `error: ${msg}`;
  }
}

export type { Tool } from "./types.ts";
