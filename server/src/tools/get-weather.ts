import { spawn } from "node:child_process";

import type { Tool } from "./types.ts";

// `python` is absent on macOS and on node:alpine; `python3` exists on both.
// Override with PYTHON_BIN if your environment differs.
const PYTHON_BIN = process.env.PYTHON_BIN ?? "python3";
const SCRIPT_PATH = "tools/get_weather.py";

/**
 * Runs `python3 tools/get_weather.py` (cwd = server process dir) and resolves
 * with trimmed stdout. Rejects on spawn failure or non-zero exit.
 */
function runScript(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [SCRIPT_PATH]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) =>
      reject(new Error(`failed to spawn ${PYTHON_BIN}: ${err.message}`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${SCRIPT_PATH} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export function createGetWeatherTool(): Tool {
  return {
    name: "get_weather",
    description:
      "Get the current weather. Returns a JSON object with the sky status and the day's high/low temperature in Celsius.",
    // No parameters — the script returns fixed demo data.
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute(): Promise<string> {
      const out = await runScript();
      return out.length > 0 ? out : "(no output)";
    },
  };
}
