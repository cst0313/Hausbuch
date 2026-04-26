// path: src/components/UploadInspector.tsx
"use client";

import React, { useRef, useState } from "react";
import { PdfHighlightView } from "./PdfHighlightView";

type FactDetail = {
  entity: string;
  predicate: string;
  value: string;
  quote: string;
};

type FileResult = {
  name: string;
  size: number;
  kind: string;
  facts: number;
  conflicts: number;
  latency_ms: number;
  extract_preview: string;
  extractor?: string;
  error?: string;
  source_id?: string;
  fact_details?: FactDetail[];
};

type EntityChanged = {
  id: string;
  name: string;
  type: string;
  fact_count: number;
};

type UploadResponse = {
  entity: string;
  uploaded: FileResult[];
  entities_changed?: EntityChanged[];
  facts_added?: number;
  files_processed?: number;
  files_total?: number;
};

export type IngestSummary = {
  entities_changed: EntityChanged[];
  facts_added: number;
  files_processed: number;
  files_total: number;
};

export function UploadInspector({ onIngested }: { onIngested?: (summary: IngestSummary) => void } = {}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [originalFiles, setOriginalFiles] = useState<Map<string, File>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);

    // Keep originals so the PDF highlight view can render them client-side
    // (the server returns extracted text + spans; the visual overlay needs
    // the actual PDF bytes).  For a zip, unpack it in the browser so each
    // inner PDF is keyed by its basename — the same key the server returns
    // in `uploaded[].name`. JSZip is loaded lazily only when needed.
    const fresh = new Map<string, File>();
    const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip";
    if (isZip) {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        for (const [name, entry] of Object.entries(zip.files)) {
          if (entry.dir) continue;
          if (!/\.pdf$/i.test(name)) continue;
          const blob = await entry.async("blob");
          const baseName = name.split("/").pop() ?? name;
          fresh.set(
            baseName,
            new File([blob], baseName, { type: "application/pdf" }),
          );
        }
      } catch (err) {
        console.warn("[upload] zip unpack failed:", err);
      }
    } else {
      fresh.set(file.name, file);
    }
    setOriginalFiles(fresh);
    try {
      const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip";
      const fd = new FormData();
      // /api/upload-bulk wants `file` (singular, the zip itself);
      // /api/upload wants `files` (plural, individual documents).
      fd.append(isZip ? "file" : "files", file);
      const endpoint = isZip ? "/api/upload-bulk" : "/api/upload";
      const r = await fetch(endpoint, { method: "POST", body: fd });
      const data = (await r.json()) as UploadResponse | { error: string };
      if (!r.ok || "error" in data) {
        setError("error" in data ? data.error : `HTTP ${r.status}`);
        return;
      }
      setResult(data);
      // Tell parent (e.g. /sandbox) what just landed — the entities the
      // ingest touched, fact / file counts. The sandbox uses this to
      // filter /api/recommendations to JUST these entities, instead of
      // surfacing the seeded corpus's pre-existing 200+ open recs.
      onIngested?.({
        entities_changed: data.entities_changed ?? [],
        facts_added: data.facts_added ?? 0,
        files_processed: data.files_processed ?? data.uploaded?.length ?? 0,
        files_total: data.files_total ?? data.uploaded?.length ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
        style={{
          padding: "32px 24px",
          border: "1.5px dashed " + (dragOver ? "var(--brand)" : "var(--border)"),
          borderRadius: 12,
          background: dragOver ? "var(--brand-wash)" : "var(--bg-elevated)",
          textAlign: "center",
          cursor: "pointer",
          transition: "background 120ms, border-color 120ms",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".eml,.txt,.md,.pdf,.json,.csv,.jpg,.jpeg,.png,.webp,.zip"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--brand)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 8,
          }}
        >
          {busy ? "▸▸▸ extracting…" : dragOver ? "drop to inspect" : "drop a file"}
        </div>
        <div style={{ fontSize: 16, fontWeight: 500, color: "var(--fg)", letterSpacing: "-0.01em" }}>
          Drop an email, PDF, scanned letter, or photo
        </div>
        <div style={{ fontSize: 13, color: "var(--fg-muted)", marginTop: 6 }}>
          See the entities and facts Hausbuch extracts, with citations.
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            background: "rgba(153,27,27,0.08)",
            border: "1px solid rgba(153,27,27,0.25)",
            fontSize: 12,
            color: "var(--rep-avoid)",
          }}
        >
          {error}
        </div>
      )}

      {result &&
        result.uploaded.map((file, idx) => (
          <FileResultCard
            key={idx}
            file={file}
            originalFile={originalFiles.get(file.name) ?? null}
          />
        ))}
    </div>
  );
}

function FileResultCard({
  file,
  originalFile,
}: {
  file: FileResult;
  originalFile: File | null;
}) {
  type ViewMode = "off" | "text" | "pdf";
  const [view, setView] = useState<ViewMode>("off");
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [hoveredQuote, setHoveredQuote] = useState<string | null>(null);
  const showSource = view !== "off";
  // PDF mode is available whenever we still have the original PDF bytes —
  // either from a single-file upload or freshly unpacked from a zip.
  const canShowPdf = originalFile !== null && /\.pdf$/i.test(originalFile.name);

  // Lazy-load the full source text the first time the user expands the highlight view.
  React.useEffect(() => {
    if (!showSource || sourceText !== null || !file.source_id) return;
    fetch(`/api/source/${encodeURIComponent(file.source_id)}`)
      .then((r) => r.json())
      .then((d) => setSourceText(d.source?.raw_excerpt ?? file.extract_preview ?? ""))
      .catch(() => setSourceText(file.extract_preview ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSource]);

  if (file.error) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 10,
          border: "1px solid rgba(153,27,27,0.25)",
          background: "rgba(153,27,27,0.05)",
        }}
      >
        <div style={{ fontSize: 13, color: "var(--rep-avoid)" }}>
          <strong>{file.name}</strong>: {file.error}
        </div>
      </div>
    );
  }

  // Group facts by entity so the user sees the small graph clearly.
  const byEntity = new Map<string, FactDetail[]>();
  for (const f of file.fact_details ?? []) {
    const arr = byEntity.get(f.entity) ?? [];
    arr.push(f);
    byEntity.set(f.entity, arr);
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-elevated)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--border-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: "-0.005em", color: "var(--fg)" }}>
            {file.name}
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 2 }}>
            {file.kind} · extractor: {file.extractor ?? "—"} · {file.latency_ms}ms
          </div>
        </div>
        <div style={{ display: "flex", gap: 14, flexShrink: 0 }}>
          <Stat label="Facts" value={file.facts} />
          {file.conflicts > 0 && <Stat label="Conflicts" value={file.conflicts} accent />}
        </div>
      </div>

      <div
        style={{
          padding: "10px 18px",
          borderBottom: "1px solid var(--border-muted)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--fg-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          highlight spans:
        </span>
        <ModePill
          active={view === "off"}
          onClick={() => setView("off")}
          label="off"
        />
        <ModePill
          active={view === "text"}
          onClick={() => setView("text")}
          label="on text"
        />
        {canShowPdf && (
          <ModePill
            active={view === "pdf"}
            onClick={() => setView("pdf")}
            label="on PDF"
          />
        )}
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginLeft: "auto" }}>
          {(file.fact_details ?? []).filter((f) => f.quote).length} spans
        </span>
      </div>

      {view === "text" && (
        <div
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid var(--border-muted)",
            background: "var(--bg)",
          }}
        >
          {sourceText === null ? (
            <span className="mono pulse" style={{ fontSize: 11, color: "var(--fg-dim)" }}>
              ▸▸▸ loading source…
            </span>
          ) : (
            <HighlightedSource
              text={sourceText}
              spans={(file.fact_details ?? []).filter((f) => f.quote)}
              hovered={hoveredQuote}
            />
          )}
        </div>
      )}

      {view === "pdf" && originalFile && (
        <div
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid var(--border-muted)",
            background: "var(--bg)",
          }}
        >
          <PdfHighlightView
            file={originalFile}
            spans={(file.fact_details ?? []).filter((f) => f.quote)}
            hovered={hoveredQuote}
          />
        </div>
      )}

      {byEntity.size === 0 ? (
        <div style={{ padding: "14px 18px", fontSize: 12, color: "var(--fg-dim)" }}>
          No facts extracted (low signal).
        </div>
      ) : (
        <div style={{ padding: "10px 0" }}>
          {Array.from(byEntity.entries()).map(([entity, facts]) => (
            <div key={entity} style={{ padding: "8px 18px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <div className="mono" style={{ fontSize: 11, color: "var(--fg)" }}>
                  <span style={{ color: "var(--fg-dim)" }}>{entity.split(":")[0]}:</span>
                  {entity.split(":").slice(1).join(":")}
                </div>
                <a
                  href={`/context/${encodeURIComponent(entity)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--brand)",
                    textDecoration: "none",
                  }}
                >
                  view Context.md →
                </a>
              </div>
              <div
                style={{
                  border: "1px solid var(--border-muted)",
                  borderRadius: 6,
                  overflow: "hidden",
                }}
              >
                {facts.map((f, i) => {
                  const isHovered = hoveredQuote && f.quote === hoveredQuote;
                  return (
                    <div
                      key={`${f.predicate}-${i}`}
                      onMouseEnter={() => f.quote && setHoveredQuote(f.quote)}
                      onMouseLeave={() => setHoveredQuote(null)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "200px 1fr",
                        gap: 12,
                        padding: "8px 12px",
                        fontSize: 11,
                        borderBottom: i < facts.length - 1 ? "1px solid var(--border-muted)" : "none",
                        background: isHovered ? "var(--brand-wash)" : "var(--bg)",
                        cursor: f.quote ? "help" : "default",
                        transition: "background 80ms",
                      }}
                      title={f.quote ? `extracted from: "${f.quote}"` : f.value}
                    >
                      <span className="mono" style={{ color: "var(--brand)" }}>
                        {f.predicate}
                      </span>
                      <span style={{ color: "var(--fg)" }}>{f.value}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Render the source text with each fact's quote highlighted in place.
 * Hovering a fact in the list above sets `hovered` to its quote string —
 * that span gets the strong (brand) treatment, the rest stay subtle yellow.
 *
 * Algorithm: scan the text once; at each position, find the longest matching
 * span. We pre-sort spans by length descending so longer matches win when
 * two spans share a prefix.
 */
function HighlightedSource({
  text,
  spans,
  hovered,
}: {
  text: string;
  spans: Array<{ predicate: string; quote: string }>;
  hovered: string | null;
}) {
  // Dedup quotes (a fact-row may share the same quote with another) and sort
  // longer-first so longer matches win when nested.
  const uniqueQuotes = Array.from(new Set(spans.map((s) => s.quote))).sort(
    (a, b) => b.length - a.length,
  );

  // Build segments by walking the text; greedy first-match per quote.
  type Seg = { text: string; quote: string | null };
  const segs: Seg[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let nextHit: { idx: number; quote: string } | null = null;
    for (const q of uniqueQuotes) {
      if (q.length < 3) continue;
      const idx = text.indexOf(q, cursor);
      if (idx >= 0 && (!nextHit || idx < nextHit.idx)) {
        nextHit = { idx, quote: q };
        if (idx === cursor) break;
      }
    }
    if (!nextHit) {
      segs.push({ text: text.slice(cursor), quote: null });
      break;
    }
    if (nextHit.idx > cursor) {
      segs.push({ text: text.slice(cursor, nextHit.idx), quote: null });
    }
    segs.push({ text: nextHit.quote, quote: nextHit.quote });
    cursor = nextHit.idx + nextHit.quote.length;
  }

  return (
    <pre
      className="mono"
      style={{
        fontSize: 11,
        lineHeight: 1.55,
        color: "var(--fg)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
        maxHeight: 360,
        overflow: "auto",
        padding: "10px 12px",
        background: "var(--bg-elevated)",
        borderRadius: 6,
        border: "1px solid var(--border-muted)",
      }}
    >
      {segs.map((s, i) =>
        s.quote === null ? (
          <span key={i} style={{ color: "var(--fg-muted)" }}>
            {s.text}
          </span>
        ) : (
          <mark
            key={i}
            style={{
              background:
                hovered === s.quote ? "var(--brand)" : "rgba(245, 200, 102, 0.45)",
              color: hovered === s.quote ? "white" : "var(--fg)",
              padding: "1px 3px",
              borderRadius: 3,
              transition: "background 100ms, color 100ms",
            }}
            title="extracted span"
          >
            {s.text}
          </mark>
        ),
      )}
    </pre>
  );
}

function ModePill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="mono"
      style={{
        padding: "3px 8px",
        borderRadius: 999,
        border: "1px solid " + (active ? "var(--brand)" : "var(--border-muted)"),
        background: active ? "var(--brand-wash)" : "transparent",
        color: active ? "var(--brand)" : "var(--fg-muted)",
        fontSize: 10,
        cursor: "pointer",
        fontFamily: "inherit",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {label}
    </button>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div
        className="mono"
        style={{
          fontSize: 9,
          color: "var(--fg-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: accent ? "var(--high)" : "var(--brand)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
