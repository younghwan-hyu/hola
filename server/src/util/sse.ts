import type { Response } from "express";

export interface SseTarget {
  write(event: string, data: unknown): void;
  end(): void;
  closed: boolean;
  /**
   * Register a callback for the client going away *before* we ended the stream
   * ourselves — a closed tab, a dropped connection, or the web client's stop
   * button (which closes its EventSource on purpose). Never fires for an end()
   * we initiated. Fires immediately if the client is already gone.
   */
  onDisconnect(cb: () => void): void;
}

export function attachSse(res: Response): SseTarget {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let closed = false;
  // Set by end(). Both a finished stream and a vanished client surface as the
  // same 'close' event, and only the latter should abort the work behind it.
  let ended = false;
  const disconnectHandlers: Array<() => void> = [];

  res.on("close", () => {
    closed = true;
    if (ended) return;
    for (const cb of disconnectHandlers.splice(0)) cb();
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
      ended = true;
      res.end();
    },
    get closed() {
      return closed;
    },
    onDisconnect(cb: () => void) {
      if (closed) {
        if (!ended) cb();
        return;
      }
      disconnectHandlers.push(cb);
    },
  };
}
