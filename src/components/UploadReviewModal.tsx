// path: src/components/UploadReviewModal.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { PdfHighlightView } from "./PdfHighlightView";

/**
 * Dashboard upload flow with a review-then-confirm step. Same primitives as
 * the sandbox's UploadInspector (PDF highlight overlays, source text view),
 * but adds:
 *   - editable predicate / value / target_entity per row
 *   - per-fact "skip" toggle so the user can drop noise before commit
 *   - a final "Confirm & insert N facts" button that posts the edited payload
 *     to /api/upload/commit (so the DB never sees the unedited version)
 *
 * Server contract:
 *   1. POST /api/upload?preview=1   (or /api/upload-bulk?preview=1 for zip)
 *      → returns { uploaded: [{ name, kind, fact_details: [...], extract_preview, ... }] }
 *      → does NOT write to the DB
 *   2. POST /api/upload/commit { items: [{ name, kind, raw_excerpt, target_entity, facts }] }
 *      → writes one source + N facts per item with confidence 0.95
 */

type FactRow = {
  predicate: string;
  value: string;
  entity: string;
  quote: string;
  skip: boolean;
};

type FilePreview = {
  name: string;
  kind: string;
  size: number;
  extract_preview: string;
  facts: FactRow[];
  /** Original File object kept client-side so the PDF highlighter has the bytes. */
  original: File | null;
};

type Stage = "drop" | "extracting" | "review" | "committing" | "done";

export function UploadReviewModal({
  open,
  onClose,
  onCommitted,
}: {
  open: boolean;
  onClose: () => void;
  onCommitted: (summary: { facts: number; sources: number }) => void;
}) {
  const [stage, setStage] = useState<Stage>("drop");
  const [files, setFiles] = useState<FilePreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStage("drop");
      setFiles([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleFile = async (file: File) => {
    setStage("extracting");
    setError(null);
    try {
      const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip";
      // Build per-name → original PDF map. For zips, unpack client-side.
      const originals = new Map<string, File>();
      if (isZip) {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        for (const [name, entry] of Object.entries(zip.files)) {
          if (entry.dir) continue;
          if (!/\.pdf$/i.test(name)) continue;
          const blob = await entry.async("blob");
          const baseName = name.split("/").pop() ?? name;
          originals.set(
            baseName,
            new File([blob], baseName, { type: "application/pdf" }),
          );
        }
      } else {
        originals.set(file.name, file);
      }

      const fd = new FormData();
      fd.append(isZip ? "file" : "files", file);
      const endpoint = isZip ? "/api/upload-bulk?preview=1" : "/api/upload?preview=1";
      const r = await fetch(endpoint, { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      const previews: FilePreview[] = (data.uploaded ?? []).map(
        (u: {
          name: string;
          kind: string;
          size?: number;
          extract_preview: string;
          fact_details?: Array<{ entity: string; predicate: string; value: string; quote: string }>;
        }) => ({
          name: u.name,
          kind: u.kind,
          size: u.size ?? 0,
          extract_preview: u.extract_preview ?? "",
          original: originals.get(u.name) ?? null,
          facts: (u.fact_details ?? []).map((f) => ({
            predicate: f.predicate,
            value: f.value,
            entity: f.entity,
            quote: f.quote,
            skip: false,
          })),
        }),
      );
      setFiles(previews);
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("drop");
    }
  };

  const updateFact = (
    fileIdx: number,
    factIdx: number,
    patch: Partial<FactRow>,
  ) => {
    setFiles((prev) =>
      prev.map((f, i) =>
        i !== fileIdx
          ? f
          : { ...f, facts: f.facts.map((row, ri) => (ri !== factIdx ? row : { ...row, ...patch })) },
      ),
    );
  };

  const updateAllFactsForFile = (fileIdx: number, patch: Partial<FactRow>) => {
    setFiles((prev) =>
      prev.map((f, i) => (i !== fileIdx ? f : { ...f, facts: f.facts.map((row) => ({ ...row, ...patch })) })),
    );
  };

  const commit = async () => {
    setStage("committing");
    setError(null);
    try {
      const items = files.map((f) => ({
        name: f.name,
        kind: f.kind,
        raw_excerpt: f.extract_preview,
        source_prior: 0.95,
        target_entity:
          f.facts[0]?.entity ?? "weg:immanuelkirchstr-26",
        facts: f.facts
          .filter((row) => !row.skip && row.value.trim() !== "")
          .map((row) => ({
            predicate: row.predicate,
            value: row.value,
            quote: row.quote,
          })),
      }));
      const r = await fetch("/api/upload/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error ?? `HTTP ${r.status}`);
      setStage("done");
      onCommitted({ facts: data.facts_total ?? 0, sources: data.items?.length ?? 0 });
      // Brief "done" pause then close
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("review");
    }
  };

  if (!open) return null;

  const totalConfirmed = files.reduce(
    (n, f) => n + f.facts.filter((row) => !row.skip && row.value.trim() !== "").length,
    0,
  );
  const totalSkipped = files.reduce(
    (n, f) => n + f.facts.filter((row) => row.skip).length,
    0,
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 240,
        background: "rgba(28,26,22,0.45)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "4vh",
        paddingBottom: "4vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 1100,
          maxWidth: "96%",
          maxHeight: "92vh",
          background: "var(--bg)",
          borderRadius: 12,
          border: "1px solid var(--border-muted)",
          boxShadow: "0 30px 90px rgba(28,26,22,0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 14,
            flexShrink: 0,
          }}
        >
          <div>
            <p
              className="mono"
              style={{
                margin: 0,
                fontSize: 11,
                color: "var(--brand)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Upload data · review before commit
            </p>
            <h2
              style={{
                margin: "4px 0 0",
                fontSize: 22,
                fontWeight: 500,
                letterSpacing: "-0.02em",
              }}
            >
              {stage === "drop" && "Drop a PDF, .eml, or zip"}
              {stage === "extracting" && "Extracting facts…"}
              {stage === "review" &&
                `Review ${files.length} doc${files.length === 1 ? "" : "s"} · ${totalConfirmed} fact${totalConfirmed === 1 ? "" : "s"} ready`}
              {stage === "committing" && "Writing to the engine…"}
              {stage === "done" && "Committed"}
            </h2>
            {stage === "review" && totalSkipped > 0 && (
              <p
                className="mono"
                style={{ margin: "4px 0 0", fontSize: 11, color: "var(--fg-dim)" }}
              >
                {totalSkipped} skipped · these won&apos;t be inserted
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--fg-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "inherit",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16">
              <path
                d="M3 3l10 10M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: "18px 24px" }}>
          {error && (
            <div
              className="mono"
              style={{
                padding: "10px 14px",
                borderRadius: 6,
                background: "rgba(153,27,27,0.07)",
                border: "1px solid rgba(153,27,27,0.25)",
                color: "var(--rep-avoid)",
                fontSize: 12,
                marginBottom: 14,
              }}
            >
              {error}
            </div>
          )}

          {stage === "drop" && (
            <DropZone
              onPick={() => inputRef.current?.click()}
              onDrop={(file) => handleFile(file)}
            />
          )}

          {stage === "extracting" && (
            <div
              className="mono pulse"
              style={{ fontSize: 12, color: "var(--brand)", padding: "40px 0", textAlign: "center" }}
            >
              ▸▸▸ extracting facts · routing entities · computing spans…
            </div>
          )}

          {stage === "committing" && (
            <div
              className="mono pulse"
              style={{ fontSize: 12, color: "var(--brand)", padding: "40px 0", textAlign: "center" }}
            >
              ▸▸▸ writing {totalConfirmed} fact{totalConfirmed === 1 ? "" : "s"}…
            </div>
          )}

          {stage === "done" && (
            <div
              className="mono"
              style={{ fontSize: 13, color: "var(--brand)", padding: "30px 0", textAlign: "center" }}
            >
              ✓ Committed. The dashboard will refresh.
            </div>
          )}

          {stage === "review" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {files.map((f, fi) => (
                <FileReviewBlock
                  key={fi}
                  file={f}
                  hovered={hovered}
                  setHovered={setHovered}
                  onUpdate={(factIdx, patch) => updateFact(fi, factIdx, patch)}
                  onSkipAll={() => updateAllFactsForFile(fi, { skip: true })}
                  onUnskipAll={() => updateAllFactsForFile(fi, { skip: false })}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {stage === "review" && (
          <div
            style={{
              padding: "14px 24px",
              borderTop: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              flexShrink: 0,
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--fg-dim)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
                flex: 1,
              }}
            >
              {totalConfirmed} fact{totalConfirmed === 1 ? "" : "s"} will be inserted across{" "}
              {files.length} source{files.length === 1 ? "" : "s"} ·{" "}
              user-confirmed → confidence 0.95
            </span>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                onClick={onClose}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--fg-muted)",
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
              <button
                onClick={commit}
                disabled={totalConfirmed === 0}
                style={{
                  padding: "8px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--brand)",
                  background: totalConfirmed === 0 ? "var(--brand-wash)" : "var(--brand)",
                  color: totalConfirmed === 0 ? "var(--brand)" : "white",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: totalConfirmed === 0 ? "default" : "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                Confirm &amp; insert {totalConfirmed} fact{totalConfirmed === 1 ? "" : "s"} →
              </button>
            </div>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".eml,.txt,.md,.pdf,.json,.csv,.jpg,.jpeg,.png,.webp,.zip"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            if (inputRef.current) inputRef.current.value = "";
          }}
        />
      </div>
    </div>
  );
}

// ── Drop zone ───────────────────────────────────────────────────────────────

function DropZone({
  onPick,
  onDrop,
}: {
  onPick: () => void;
  onDrop: (file: File) => void;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      onClick={onPick}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onDrop(f);
      }}
      style={{
        padding: "40px 24px",
        border: "1.5px dashed " + (drag ? "var(--brand)" : "var(--border)"),
        borderRadius: 12,
        background: drag ? "var(--brand-wash)" : "var(--bg-elevated)",
        textAlign: "center",
        cursor: "pointer",
      }}
    >
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
        {drag ? "drop to extract" : "drop a file"}
      </div>
      <div style={{ fontSize: 16, fontWeight: 500, color: "var(--fg)", letterSpacing: "-0.01em" }}>
        Drop an email, PDF, scanned letter, or zip
      </div>
      <div style={{ fontSize: 13, color: "var(--fg-muted)", marginTop: 6 }}>
        We&apos;ll extract facts and let you verify each one before they hit the database.
      </div>
    </div>
  );
}

// ── Per-file review block ───────────────────────────────────────────────────

function FileReviewBlock({
  file,
  hovered,
  setHovered,
  onUpdate,
  onSkipAll,
  onUnskipAll,
}: {
  file: FilePreview;
  hovered: string | null;
  setHovered: (q: string | null) => void;
  onUpdate: (factIdx: number, patch: Partial<FactRow>) => void;
  onSkipAll: () => void;
  onUnskipAll: () => void;
}) {
  const [view, setView] = useState<"text" | "pdf">("pdf");
  const canPdf = file.original !== null && /\.pdf$/i.test(file.name);
  const activeView = canPdf ? view : "text";

  const confirmedCount = file.facts.filter((f) => !f.skip).length;
  const allSkipped = confirmedCount === 0 && file.facts.length > 0;

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
          padding: "12px 16px",
          borderBottom: "1px solid var(--border-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--fg)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file.name}
          </div>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 2 }}>
            {file.kind} · {confirmedCount}/{file.facts.length} keep · routes to{" "}
            <span style={{ color: "var(--brand)" }}>
              {file.facts[0]?.entity ?? "weg:immanuelkirchstr-26"}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {canPdf && (
            <SegBtn active={activeView === "pdf"} onClick={() => setView("pdf")}>
              PDF
            </SegBtn>
          )}
          <SegBtn active={activeView === "text"} onClick={() => setView("text")}>
            Text
          </SegBtn>
          <SegBtn
            active={false}
            onClick={allSkipped ? onUnskipAll : onSkipAll}
            tone="muted"
          >
            {allSkipped ? "Restore all" : "Skip all"}
          </SegBtn>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        {/* LEFT: source visualization */}
        <div
          style={{
            padding: "12px 16px",
            borderRight: "1px solid var(--border-muted)",
            background: "var(--bg)",
            maxHeight: 480,
            overflow: "auto",
          }}
        >
          {activeView === "pdf" && file.original && (
            <PdfHighlightView
              file={file.original}
              spans={file.facts.filter((f) => !f.skip && f.quote)}
              hovered={hovered}
            />
          )}
          {activeView === "text" && (
            <pre
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--fg)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                margin: 0,
              }}
            >
              {file.extract_preview.slice(0, 4000)}
            </pre>
          )}
        </div>

        {/* RIGHT: editable fact list */}
        <div style={{ maxHeight: 480, overflow: "auto" }}>
          {file.facts.length === 0 ? (
            <div style={{ padding: 18, fontSize: 12, color: "var(--fg-dim)" }}>
              No facts extracted from this file.
            </div>
          ) : (
            file.facts.map((row, ri) => (
              <FactEditRow
                key={ri}
                row={row}
                onUpdate={(patch) => onUpdate(ri, patch)}
                onHover={() => row.quote && setHovered(row.quote)}
                onLeave={() => setHovered(null)}
                bordered={ri < file.facts.length - 1}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function FactEditRow({
  row,
  onUpdate,
  onHover,
  onLeave,
  bordered,
}: {
  row: FactRow;
  onUpdate: (patch: Partial<FactRow>) => void;
  onHover: () => void;
  onLeave: () => void;
  bordered: boolean;
}) {
  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        padding: "8px 14px",
        borderBottom: bordered ? "1px solid var(--border-muted)" : "none",
        background: row.skip ? "rgba(180,83,9,0.04)" : "transparent",
        display: "grid",
        gridTemplateColumns: "20px minmax(160px, 1fr) minmax(120px, 1.2fr)",
        gap: 8,
        alignItems: "center",
        opacity: row.skip ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={!row.skip}
        onChange={(e) => onUpdate({ skip: !e.target.checked })}
        title={row.skip ? "Include this fact" : "Skip this fact"}
        style={{ accentColor: "var(--brand)", cursor: "pointer" }}
      />
      <input
        type="text"
        value={row.predicate}
        onChange={(e) => onUpdate({ predicate: e.target.value })}
        disabled={row.skip}
        className="mono"
        style={{
          padding: "4px 6px",
          borderRadius: 4,
          border: "1px solid transparent",
          background: "transparent",
          color: "var(--brand)",
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          outline: "none",
          minWidth: 0,
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--border-muted)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
      />
      <input
        type="text"
        value={row.value}
        onChange={(e) => onUpdate({ value: e.target.value })}
        disabled={row.skip}
        style={{
          padding: "4px 6px",
          borderRadius: 4,
          border: "1px solid transparent",
          background: "transparent",
          color: "var(--fg)",
          fontSize: 12,
          fontFamily: "inherit",
          outline: "none",
          minWidth: 0,
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "var(--border-muted)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
      />
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "muted";
}) {
  return (
    <button
      onClick={onClick}
      className="mono"
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        border: "1px solid " + (active ? "var(--brand)" : "var(--border-muted)"),
        background: active ? "var(--brand-wash)" : "transparent",
        color: active ? "var(--brand)" : tone === "muted" ? "var(--fg-dim)" : "var(--fg-muted)",
        fontSize: 10,
        cursor: "pointer",
        fontFamily: "inherit",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </button>
  );
}
