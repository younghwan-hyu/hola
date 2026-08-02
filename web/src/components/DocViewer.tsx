import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Loader2,
} from "lucide-react";
import {
  getDocument,
  GlobalWorkerOptions,
  RenderingCancelledException,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { Button } from "@/components/ui/button";

// Ship the pdf.js worker as a bundled same-origin asset (works in dev + build).
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface DocViewerHandle {
  /**
   * Render the page currently being viewed to a JPEG blob for a chat turn.
   * Resolves null when no document is open or rendering fails, so the caller
   * just sends the turn without a document capture (mirrors captureFrame()).
   */
  capturePage: () => Promise<Blob | null>;
}

// Capture render: long-edge px / JPEG quality of the frame sent with a turn.
// Larger than the camera's 1024 — slide/body text must stay legible.
const CAPTURE_MAX_PX = 1536;
const CAPTURE_QUALITY = 0.8;
// Space kept around the rendered page inside the pane.
const PAGE_MARGIN = 24;

/**
 * Left-pane PDF viewer for 문서 조회 모드. The user opens an arbitrary local
 * PDF via the file picker (nothing is uploaded on open — only capturePage()
 * snapshots leave the browser, attached to chat turns), flips pages, and can
 * switch to another file any time. Rendering is pdf.js onto a fit-to-pane
 * canvas; the pane re-fits on resize via a (debounced) ResizeObserver.
 */
export const DocViewer = forwardRef<DocViewerHandle>(function DocViewer(
  _props,
  ref,
) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pane size drives the fit scale; null until the first measure.
  const [paneSize, setPaneSize] = useState<{ w: number; h: number } | null>(
    null,
  );

  const paneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  // The loading task owns the worker connection; destroy() lives on it (v6),
  // so it's kept alongside the doc proxy it produced.
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  // Mirrors read by the (stable) imperative handle and unmount cleanup.
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const pageRef = useRef(1);
  pageRef.current = page;

  const openFile = async (file: File | undefined) => {
    if (!file || loading) return;
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      setError("PDF 파일만 열 수 있습니다");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const task = getDocument({ data });
      const next = await task.promise;
      const prevTask = loadingTaskRef.current;
      loadingTaskRef.current = task;
      docRef.current = next;
      setDoc(next);
      setFilename(file.name);
      setPageCount(next.numPages);
      setPage(1);
      // The render effect has switched to `next`; the old doc can go now.
      if (prevTask) void prevTask.destroy().catch(() => {});
    } catch (e) {
      setError(
        `PDF를 열 수 없습니다: ${e instanceof Error ? e.message : "unknown"}`,
      );
    } finally {
      setLoading(false);
    }
  };

  // Track the pane size (debounced) so the page re-fits when the pane resizes
  // — e.g. the window resizes, or the pane un-hides when the mode turns on.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    let timer: number | null = null;
    const measure = () => {
      const w = Math.round(pane.clientWidth);
      const h = Math.round(pane.clientHeight);
      setPaneSize((prev) =>
        prev && prev.w === w && prev.h === h ? prev : { w, h },
      );
    };
    const observer = new ResizeObserver(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(measure, 120);
    });
    observer.observe(pane);
    measure();
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  // Fit-render the current page into the display canvas whenever the document,
  // page or pane size changes. An in-flight render is cancelled and drained
  // first (page flips / resizes can outpace rendering on one shared canvas).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas || !paneSize || paneSize.w <= 0 || paneSize.h <= 0)
      return;
    let stale = false;
    void (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        const prev = renderTaskRef.current;
        if (prev) {
          prev.cancel();
          await prev.promise.catch(() => {});
        }
        if (stale) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const fit = Math.min(
          (paneSize.w - PAGE_MARGIN * 2) / base.width,
          (paneSize.h - PAGE_MARGIN * 2) / base.height,
        );
        const dpr = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({
          scale: Math.max(fit, 0.05) * dpr,
        });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const task = pdfPage.render({ canvas, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (e) {
        // Cancellations are routine (rapid page flips); a doc swapped out
        // mid-render also lands here via `stale`.
        if (!stale && !(e instanceof RenderingCancelledException)) {
          console.error("PDF render failed", e);
        }
      }
    })();
    return () => {
      stale = true;
    };
  }, [doc, page, paneSize]);

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
      void loadingTaskRef.current?.destroy().catch(() => {});
      loadingTaskRef.current = null;
      docRef.current = null;
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      async capturePage() {
        const current = docRef.current;
        if (!current) return null;
        try {
          // Render the page fresh at capture size (independent of the pane) so
          // the model always gets legible text, not a shrunken screen copy.
          const pdfPage = await current.getPage(pageRef.current);
          const base = pdfPage.getViewport({ scale: 1 });
          const scale = CAPTURE_MAX_PX / Math.max(base.width, base.height);
          const viewport = pdfPage.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          await pdfPage.render({ canvas, viewport }).promise;
          return await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((b) => resolve(b), "image/jpeg", CAPTURE_QUALITY),
          );
        } catch {
          return null;
        }
      },
    }),
    [],
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-zinc-950">
      {/* Header: current filename + open/change */}
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-white/10 px-4">
        <BookOpen className="h-4 w-4 shrink-0 text-white/50" />
        <span
          className="min-w-0 flex-1 truncate text-sm text-white/90"
          title={filename ?? undefined}
        >
          {filename ?? "문서 조회"}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => {
            void openFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {doc && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={() => fileInputRef.current?.click()}
            className="h-8 shrink-0 gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 text-xs text-white hover:bg-white/15 hover:text-white"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderOpen className="h-3.5 w-3.5" />
            )}
            다른 PDF 파일 선택
          </Button>
        )}
      </div>

      {/* Page canvas, fit to the pane */}
      <div ref={paneRef} className="relative min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full w-full items-center justify-center">
          <canvas
            ref={canvasRef}
            className={`rounded-md bg-white shadow-2xl shadow-black/60 ${
              doc ? "" : "hidden"
            }`}
          />
        </div>
        {!doc && !loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Button
              type="button"
              variant="secondary"
              className="gap-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <FolderOpen className="h-4 w-4" />
              PDF 파일 선택
            </Button>
          </div>
        )}
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-sm text-white/80 backdrop-blur">
              <Loader2 className="h-4 w-4 animate-spin" />
              문서 여는 중…
            </div>
          </div>
        )}
        {error && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
            <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          </div>
        )}
      </div>

      {/* Pager */}
      {doc && (
        <div className="flex h-12 shrink-0 items-center justify-center gap-3 border-t border-white/10 px-4">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={page <= 1}
            title="이전 페이지"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="h-8 w-8 rounded-full border border-white/15 bg-white/5 text-white hover:bg-white/15 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-14 text-center text-sm tabular-nums text-white/80">
            {page} / {pageCount}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={page >= pageCount}
            title="다음 페이지"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            className="h-8 w-8 rounded-full border border-white/15 bg-white/5 text-white hover:bg-white/15 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
});
