import type { Response } from "express";

export interface SseTarget {
  write(event: string, data: unknown): void;
  end(): void;
  closed: boolean;
}

export function attachSse(res: Response): SseTarget {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  return {
    write(event: string, data: unknown) {
      if (closed) return;
      const payload =
        typeof data === "string" ? data : JSON.stringify(data);
      res.write(`event: ${event}\n`);
      for (const line of payload.split("\n")) {
        res.write(`data: ${line}\n`);
      }
      res.write("\n");
    },
    end() {
      if (closed) return;
      closed = true;
      res.end();
    },
    get closed() {
      return closed;
    },
  };
}
