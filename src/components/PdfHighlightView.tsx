// path: src/components/PdfHighlightView.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type Span = { predicate: string; quote: string; value?: string };

// pdf.js UMD shape attached to window.pdfjsLib by the CDN bundle.
type PdfJs = {
  getDocument: (src: { data: Uint8Array }) => { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
};
type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
};
type PdfPage = {
  getViewport: (opts: { scale: number }) => PdfViewport;
  // v3 takes { canvasContext, viewport }; v4+ adds { canvas }. Pass the
  // superset and v3 ignores the extra key.
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
    canvas?: HTMLCanvasElement;
  }) => { promise: Promise<void> };
  getTextContent: () => Promise<{ items: unknown[] }>;
};
type PdfViewport = {
  width: number;
  height: number;
  scale: number;
  convertToViewportPoint: (x: number, y: number) => [number, number];
};

// v3 has a real UMD build that attaches `pdfjsLib` to window. v4+ went
// ESM-only and would require an inline import-script dance to expose globals.
const PDFJS_VERSION = "3.11.174";
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

let pdfJsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  const w = window as unknown as { pdfjsLib?: PdfJs };
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (pdfJsPromise) return pdfJsPromise;

  pdfJsPromise = new Promise<PdfJs>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${PDFJS_BASE}/pdf.min.js`; // UMD, attaches window.pdfjsLib
    script.async = true;
    script.onerror = () =>
      reject(new Error(`could not load pdf.js v${PDFJS_VERSION} from cdnjs`));
    script.onload = () => {
      if (!w.pdfjsLib) {
        reject(new Error("pdf.js loaded but window.pdfjsLib is missing"));
        return;
      }
      w.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
      resolve(w.pdfjsLib);
    };
    document.head.appendChild(script);
  });
  return pdfJsPromise;
}

/**
 * Renders the original PDF as a canvas image with each extracted span
 * highlighted in place. Uses pdfjs-dist's text-content API to map every
 * fact's verbatim quote back to its (x, y, w, h) rectangle on the page.
 *
 * Algorithm per page:
 *   1. Render the page to a canvas at 1.5× scale.
 *   2. Pull all text items via page.getTextContent() — each carries a
 *      transform matrix and a width.
 *   3. Concatenate item strings into a single buffer with an index→item map.
 *   4. For every quote, find its substring in the buffer; the items it spans
 *      define the highlight rectangle (min x, min y, max x+w, max y+h).
 *   5. Paint absolutely-positioned divs over the canvas at those rects. The
 *      div for the currently-hovered quote (passed by the parent) gets the
 *      strong brand fill; the rest stay subtle yellow.
 */
export function PdfHighlightView({
  file,
  spans,
  hovered,
}: {
  file: File;
  spans: Span[];
  hovered: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<
    Array<{
      width: number;
      height: number;
      canvas: HTMLCanvasElement;
      rects: Array<{ quote: string; x: number; y: number; w: number; h: number }>;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let cleanupCanvases: HTMLCanvasElement[] = [];

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Load pdf.js via a UMD <script> tag from CDN. Bundling pdfjs-dist
        // through Turbopack is fragile (the package's deep mjs entry points
        // confuse the loader); the CDN script is one less moving part and
        // the lib caches at the browser level so subsequent uploads skip it.
        const pdfjs = await loadPdfJs();
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
        const renderedPages: typeof pages = [];

        for (let pageNum = 1; pageNum <= Math.min(doc.numPages, 3); pageNum++) {
          if (cancelled) break;
          const page = await doc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.5 });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          cleanupCanvases.push(canvas);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;

          // Build the text buffer + position map for highlight matching.
          const textContent = await page.getTextContent();
          let buffer = "";
          type ItemPos = {
            start: number;
            end: number;
            x: number;
            y: number;
            w: number;
            h: number;
          };
          const items: ItemPos[] = [];
          for (const it of textContent.items) {
            // pdfjs Item has str, transform [a,b,c,d,e,f], width, height
            const item = it as {
              str: string;
              transform: number[];
              width: number;
              height: number;
            };
            const str = item.str;
            if (!str) continue;
            const [a, , , d, e, f] = item.transform;
            // Transform to viewport coords. pdf.js's viewport.transform
            // accounts for scale + flipped Y. Easier path: use the raw
            // transform and apply the viewport matrix manually.
            const [vx, vy] = viewport.convertToViewportPoint(e, f);
            const w = (item.width || str.length * Math.abs(a)) * viewport.scale;
            const h = (item.height || Math.abs(d)) * viewport.scale;
            const start = buffer.length;
            buffer += str + " ";
            items.push({
              start,
              end: start + str.length,
              x: vx,
              y: vy - h,
              w,
              h,
            });
          }

          // Match each quote and compute its rect.
          const rects: typeof renderedPages[0]["rects"] = [];
          const seenQuotes = new Set<string>();
          for (const span of spans) {
            const q = (span.quote ?? "").trim();
            if (!q || q.length < 3 || seenQuotes.has(q)) continue;
            // Normalize whitespace for matching (PDF text often joins lines).
            const normBuf = buffer.replace(/\s+/g, " ");
            const normQ = q.replace(/\s+/g, " ");
            const idx = normBuf.indexOf(normQ);
            if (idx < 0) continue;
            seenQuotes.add(q);

            // Find the items overlapping [idx, idx+normQ.length) in the
            // ORIGINAL buffer (which has the same length as normBuf for the
            // ASCII-portion; using normBuf is good enough for our matches).
            const end = idx + normQ.length;
            const overlapping = items.filter((it) => it.start < end && it.end > idx);
            if (overlapping.length === 0) continue;
            // Group overlapping items by line (similar y) so multi-line quotes
            // emit one rect per line, not one giant box.
            const lines = new Map<number, ItemPos[]>();
            for (const it of overlapping) {
              const key = Math.round(it.y / 5) * 5; // 5px y-bucket
              const list = lines.get(key) ?? [];
              list.push(it);
              lines.set(key, list);
            }
            for (const [, lineItems] of lines) {
              const minX = Math.min(...lineItems.map((it) => it.x));
              const maxX = Math.max(...lineItems.map((it) => it.x + it.w));
              const minY = Math.min(...lineItems.map((it) => it.y));
              const maxY = Math.max(...lineItems.map((it) => it.y + it.h));
              rects.push({
                quote: q,
                x: minX - 1,
                y: minY - 1,
                w: maxX - minX + 2,
                h: maxY - minY + 2,
              });
            }
          }

          renderedPages.push({
            width: viewport.width,
            height: viewport.height,
            canvas,
            rects,
          });
        }

        if (!cancelled) {
          setPages(renderedPages);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanupCanvases = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Mount each rendered canvas into the DOM after pages updates.
  useEffect(() => {
    if (!containerRef.current) return;
    const c = containerRef.current;
    c.innerHTML = "";
    for (const page of pages) {
      const wrap = document.createElement("div");
      wrap.style.position = "relative";
      wrap.style.marginBottom = "12px";
      wrap.style.boxShadow = "0 1px 4px rgba(0,0,0,0.08)";
      wrap.style.borderRadius = "4px";
      wrap.style.overflow = "hidden";
      wrap.style.maxWidth = "100%";
      page.canvas.style.display = "block";
      page.canvas.style.maxWidth = "100%";
      page.canvas.style.height = "auto";
      wrap.appendChild(page.canvas);

      // Highlight overlay layer.
      const overlay = document.createElement("div");
      overlay.style.position = "absolute";
      overlay.style.inset = "0";
      overlay.style.pointerEvents = "none";
      // Scale highlights to match the canvas display width.
      const scaleX = 1; // canvas auto-scales via CSS, but the overlay is
                       // positioned in canvas pixels. We use percent-of-canvas.
      void scaleX;

      for (const rect of page.rects) {
        const isHovered = hovered === rect.quote;
        const hl = document.createElement("div");
        hl.style.position = "absolute";
        // Express in % so the overlay stays aligned when CSS scales the canvas.
        hl.style.left = `${(rect.x / page.width) * 100}%`;
        hl.style.top = `${(rect.y / page.height) * 100}%`;
        hl.style.width = `${(rect.w / page.width) * 100}%`;
        hl.style.height = `${(rect.h / page.height) * 100}%`;
        hl.style.background = isHovered
          ? "rgba(13,120,53,0.55)"
          : "rgba(245,200,102,0.40)";
        hl.style.outline = isHovered ? "1.5px solid #0d7835" : "1px solid rgba(245,200,102,0.7)";
        hl.style.transition = "background 100ms, outline 100ms";
        hl.title = rect.quote.slice(0, 100);
        overlay.appendChild(hl);
      }
      wrap.appendChild(overlay);
      c.appendChild(wrap);
    }
  }, [pages, hovered]);

  return (
    <div>
      {loading && (
        <div className="mono pulse" style={{ fontSize: 11, color: "var(--fg-dim)" }}>
          ▸▸▸ rendering PDF + computing span rectangles…
        </div>
      )}
      {error && (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--rep-avoid)",
            padding: "8px 12px",
            background: "rgba(153,27,27,0.05)",
            borderRadius: 6,
          }}
        >
          PDF render failed: {error}
        </div>
      )}
      <div ref={containerRef} />
      {!loading && !error && pages.length > 0 && (
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 6 }}>
          ▾ {pages.reduce((n, p) => n + p.rects.length, 0)} highlight rectangle
          {pages.reduce((n, p) => n + p.rects.length, 0) === 1 ? "" : "s"} ·{" "}
          {pages.length} page{pages.length === 1 ? "" : "s"} rendered
        </div>
      )}
    </div>
  );
}
