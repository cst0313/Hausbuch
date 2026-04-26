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

/**
 * Cache rendered pages per file so re-opening the same PDF for a
 * different fact is instant. Key = `${file.name}:${file.size}` —
 * stable enough for a session.
 *
 * Cap at 12 entries so a curious user opening dozens of different
 * sources doesn't hold canvases for every one.
 */
type RenderedPage = {
  pageNum: number;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  /** Pre-built per-line geometry the quote-matcher consumes directly. */
  lines: Array<{ y: number; items: LineItem[]; text: string }>;
};
type FileCacheEntry = {
  doc: PdfDoc;
  totalPages: number;
  pages: Map<number, RenderedPage>;
};
const FILE_CACHE = new Map<string, FileCacheEntry>();
const FILE_CACHE_LIMIT = 12;
function fileKey(f: File): string {
  return `${f.name}:${f.size}`;
}
function rememberFile(key: string, entry: FileCacheEntry) {
  if (FILE_CACHE.size >= FILE_CACHE_LIMIT) {
    const first = FILE_CACHE.keys().next().value;
    if (first) FILE_CACHE.delete(first);
  }
  FILE_CACHE.set(key, entry);
}

type LineItem = { str: string; x: number; y: number; w: number; h: number };

/**
 * Given a line's items and its concatenated text, return the subset of
 * items that cover the quote. Walks the items left-to-right, accumulating
 * their joined text and stopping when the running concatenation contains
 * the quote (so a tight rectangle covers exactly the matched stretch
 * rather than the whole line).
 */
function pickLineItemsForSubstring(
  items: LineItem[],
  lineText: string,
  quote: string,
): LineItem[] {
  // Locate the quote inside lineText.
  const qStart = lineText.indexOf(quote);
  if (qStart < 0) return [];
  const qEnd = qStart + quote.length;
  // Replay the join-with-space concatenation, mapping char-positions back
  // to item indices.
  let pos = 0;
  const picked: LineItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const start = pos;
    const end = pos + items[i].str.length;
    if (start < qEnd && end > qStart) picked.push(items[i]);
    pos = end + 1; // +1 for the joining space
  }
  return picked;
}

/**
 * Like pickLineItemsForSubstring but takes char-offsets directly. Used by
 * the multi-line matcher to narrow a line's items to just the ones that
 * cover the quote-portion of THAT line — without this, a 5-line agenda
 * quote painted 5 full-width rectangles even though only the first/last
 * lines were partially inside the match.
 */
function pickLineItemsForRange(
  items: LineItem[],
  charStart: number,
  charEnd: number,
): LineItem[] {
  let pos = 0;
  const picked: LineItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const start = pos;
    const end = pos + items[i].str.length;
    if (start < charEnd && end > charStart) picked.push(items[i]);
    pos = end + 1; // +1 for the joining space
  }
  return picked;
}

function makeRect(
  its: LineItem[],
  quote: string,
): { quote: string; x: number; y: number; w: number; h: number } {
  const minX = Math.min(...its.map((i) => i.x));
  const maxX = Math.max(...its.map((i) => i.x + i.w));
  const minY = Math.min(...its.map((i) => i.y));
  const maxY = Math.max(...its.map((i) => i.y + i.h));
  return {
    quote,
    x: minX - 1,
    y: minY - 1,
    w: maxX - minX + 2,
    h: maxY - minY + 2,
  };
}

/**
 * Re-run the per-line quote matcher against an already-rendered page's
 * cached line geometry. Used when the user opens a different fact whose
 * source is the same PDF — we skip rasterization entirely and only
 * compute fresh highlight rects.
 */
function computeRectsForCachedPage(
  page: RenderedPage,
  spans: Span[],
): Array<{ quote: string; x: number; y: number; w: number; h: number }> {
  const rects: Array<{ quote: string; x: number; y: number; w: number; h: number }> = [];
  const seen = new Set<string>();
  for (const span of spans) {
    const q = (span.quote ?? "").trim();
    if (!q || q.length < 3 || seen.has(q)) continue;
    const normQ = q.replace(/\s+/g, " ");
    let matched = false;
    for (let i = 0; i < page.lines.length && !matched; i++) {
      if (page.lines[i].text.includes(normQ)) {
        const its = pickLineItemsForSubstring(page.lines[i].items, page.lines[i].text, normQ);
        if (its.length > 0) {
          rects.push(makeRect(its, q));
          matched = true;
          break;
        }
      }
      for (let j = i + 1; j < Math.min(page.lines.length, i + 8); j++) {
        const joined = page.lines.slice(i, j + 1).map((l) => l.text).join(" ");
        const qs = joined.indexOf(normQ);
        if (qs < 0) continue;
        const qe = qs + normQ.length;
        let cursor = 0;
        for (let k = i; k <= j; k++) {
          const lineStart = cursor;
          const lineEnd = lineStart + page.lines[k].text.length;
          cursor = lineEnd + 1;
          const sliceStart = Math.max(qs, lineStart) - lineStart;
          const sliceEnd = Math.min(qe, lineEnd) - lineStart;
          if (sliceEnd <= 0 || sliceStart >= page.lines[k].text.length) continue;
          const its = pickLineItemsForRange(page.lines[k].items, sliceStart, sliceEnd);
          if (its.length > 0) rects.push(makeRect(its, q));
        }
        matched = true;
        break;
      }
    }
    if (matched) seen.add(q);
  }
  return rects;
}

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
        const key = fileKey(file);

        // Open (or reuse) the doc. We cache the parsed PdfDoc per-file
        // so re-opening the same source for a different fact skips the
        // ~100–200 ms parse.
        let cache = FILE_CACHE.get(key);
        if (!cache) {
          const buf = await file.arrayBuffer();
          const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
          cache = { doc, totalPages: doc.numPages, pages: new Map() };
          rememberFile(key, cache);
        }
        if (cancelled) return;

        // Decide which pages to render. Scan getTextContent on each page
        // and pick every one that contains a quote we care about — but
        // cap at 3 pages so an unbounded multi-span upload doesn't
        // rasterize the whole document. If no match found anywhere
        // (tabular PDFs whose text content order breaks substring
        // matching) fall back to page 1; the per-line matcher in the
        // render loop will still try to locate the quote there.
        const targetPages = new Set<number>();
        const wantQuotes = spans
          .map((s) => (s.quote ?? "").trim().replace(/\s+/g, " "))
          .filter((q) => q.length >= 3);
        const MAX_PAGES = 3;
        for (let pageNum = 1; pageNum <= cache.totalPages && targetPages.size < MAX_PAGES; pageNum++) {
          // If we've already cached this page's lines, scan the cached
          // text directly without re-fetching getTextContent.
          const cachedPage = cache.pages.get(pageNum);
          let flat: string;
          if (cachedPage) {
            flat = cachedPage.lines.map((l) => l.text).join(" ");
          } else {
            const page = await cache.doc.getPage(pageNum);
            const tc = await page.getTextContent();
            flat = (tc.items as Array<{ str?: string }>)
              .map((it) => it.str ?? "")
              .join(" ")
              .replace(/\s+/g, " ");
          }
          if (wantQuotes.some((q) => flat.includes(q.slice(0, 80)))) {
            targetPages.add(pageNum);
          }
        }
        if (targetPages.size === 0) targetPages.add(1);
        if (cancelled) return;

        const renderedPages: typeof pages = [];
        const SCALE = 1.25; // 1.5 → 1.25 = ~30% fewer pixels to rasterize
        for (const pageNum of targetPages) {
          if (cancelled) break;

          // Cache hit: reuse the canvas + line geometry directly.
          const cached = cache.pages.get(pageNum);
          if (cached) {
            const recomputed = computeRectsForCachedPage(cached, spans);
            renderedPages.push({
              width: cached.width,
              height: cached.height,
              canvas: cached.canvas,
              rects: recomputed,
            });
            continue;
          }

          const page = await cache.doc.getPage(pageNum);
          const viewport = page.getViewport({ scale: SCALE });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          cleanupCanvases.push(canvas);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;

          // Build per-item geometry. Crucially we DON'T concatenate items
          // into one big buffer for substring matching — pdf.js returns
          // items in PDF content-stream order, which for tabular layouts
          // interleaves label-column and number-column items. A blind
          // indexOf on that buffer found "Anteil Gesamtkosten: 5.159,98"
          // partially in some unrelated row and highlighted the wrong
          // rectangle. Group by visual line first, then match per line.
          const textContent = await page.getTextContent();
          type ItemPos = {
            str: string;
            x: number;
            y: number;
            w: number;
            h: number;
          };
          const items: ItemPos[] = [];
          for (const it of textContent.items) {
            const item = it as {
              str: string;
              transform: number[];
              width: number;
              height: number;
            };
            const str = item.str;
            if (!str) continue;
            const [a, , , d, e, f] = item.transform;
            const [vx, vy] = viewport.convertToViewportPoint(e, f);
            const w = (item.width || str.length * Math.abs(a)) * viewport.scale;
            const h = (item.height || Math.abs(d)) * viewport.scale;
            items.push({ str, x: vx, y: vy - h, w, h });
          }

          // Bucket items by visual line (y-coordinate), then within each
          // line sort left-to-right (x). This recovers reading order from
          // the unordered content-stream items.
          const lineMap = new Map<number, ItemPos[]>();
          for (const it of items) {
            const key = Math.round(it.y / 4) * 4; // 4px y-bucket — tight enough to keep rows apart in dense tables
            const list = lineMap.get(key) ?? [];
            list.push(it);
            lineMap.set(key, list);
          }
          const lines: Array<{ y: number; items: ItemPos[]; text: string }> = [];
          for (const [y, list] of lineMap) {
            list.sort((a, b) => a.x - b.x);
            // Concatenate items with single spaces; the per-line search
            // only needs to match a quote that fits on one line.
            const text = list.map((i) => i.str).join(" ").replace(/\s+/g, " ");
            lines.push({ y, items: list, text });
          }
          // Sort lines top-to-bottom for deterministic match order.
          lines.sort((a, b) => a.y - b.y);

          const rects: typeof renderedPages[0]["rects"] = [];
          const seenQuotes = new Set<string>();
          for (const span of spans) {
            const q = (span.quote ?? "").trim();
            if (!q || q.length < 3 || seenQuotes.has(q)) continue;
            const normQ = q.replace(/\s+/g, " ");

            // Try each visual line. A single quote may span multiple lines —
            // when it doesn't fit one line, we walk consecutive lines and
            // accept the longest contiguous run of lines whose joined text
            // contains the quote.
            let matched = false;
            for (let i = 0; i < lines.length && !matched; i++) {
              // 1. Single-line match.
              if (lines[i].text.includes(normQ)) {
                const its = pickLineItemsForSubstring(lines[i].items, lines[i].text, normQ);
                if (its.length > 0) {
                  rects.push(makeRect(its, q));
                  matched = true;
                  break;
                }
              }
              // 2. Multi-line match — try joining up to 8 consecutive lines.
              //    Bumped from 4 because ETV agendas legitimately span 5–7
              //    lines (TOP 1 → TOP 5) and were previously falling through.
              for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
                const joined = lines.slice(i, j + 1).map((l) => l.text).join(" ");
                const qs = joined.indexOf(normQ);
                if (qs < 0) continue;
                const qe = qs + normQ.length;
                // Map each char-offset into joined back to (lineIdx, lineOffset).
                // joined was built as lines[i].text + " " + lines[i+1].text + ...
                // so consecutive line-starts are (length so far) + (1 space per line).
                let cursor = 0;
                for (let k = i; k <= j; k++) {
                  const lineStart = cursor;
                  const lineEnd = lineStart + lines[k].text.length;
                  cursor = lineEnd + 1; // +1 for the joining space

                  // Compute the slice of THIS line that's inside [qs, qe).
                  const sliceStart = Math.max(qs, lineStart) - lineStart;
                  const sliceEnd = Math.min(qe, lineEnd) - lineStart;
                  if (sliceEnd <= 0 || sliceStart >= lines[k].text.length) continue;

                  const its = pickLineItemsForRange(
                    lines[k].items,
                    sliceStart,
                    sliceEnd,
                  );
                  if (its.length > 0) rects.push(makeRect(its, q));
                }
                matched = true;
                break;
              }
            }
            if (matched) seenQuotes.add(q);
          }

          renderedPages.push({
            width: viewport.width,
            height: viewport.height,
            canvas,
            rects,
          });

          // Cache the rasterized canvas + line geometry. Subsequent opens
          // for any other quote on the same page skip rasterization
          // entirely and just recompute rects.
          cache.pages.set(pageNum, {
            pageNum,
            width: viewport.width,
            height: viewport.height,
            canvas,
            lines,
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
