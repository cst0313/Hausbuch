// path: src/components/UploadPanel.tsx
"use client";

import { useRef, useState } from "react";

export type UploadResult = {
  files_total: number;
  files_processed: number;
  files_ingested?: number; // legacy alias
  files_skipped: number;
  facts_added: number;
  conflicts_found: number;
  conflicts?: Array<{
    fact_id: string;
    entity: string;
    entity_name: string;
    predicate: string;
    new_value: string;
    competing: Array<{ value: string; probability: number }>;
    source_title: string;
  }>;
  entities_changed: Array<{ id: string; name: string; type: string; fact_count: number }>;
  sample_subjects: string[];
  by_kind?: Record<string, number>;
  errors: string[];
  latency_ms: number;
  supported_formats?: Record<string, string[]>;
};

const ENTITY_GLYPH: Record<string, string> = {
  tenant: "◊",
  contractor: "▢",
  owner: "◇",
  unit: "▦",
  building: "⛶",
  weg: "⛶",
};

export function UploadButton({
  onResult,
}: {
  onResult: (r: UploadResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFile = async (file: File) => {
    setUploading(true);
    setProgress(0);

    // Animate progress while the request is in flight (server-side processing
    // doesn't expose intermediate progress; keep the button feeling alive).
    const tick = setInterval(() => {
      setProgress((p) => Math.min(p + 7, 92));
    }, 220);

    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload-bulk", { method: "POST", body: fd });
      const data = (await res.json()) as UploadResult;
      clearInterval(tick);
      setProgress(100);
      onResult(data);
    } catch (err) {
      clearInterval(tick);
      console.error("[upload]", err);
    } finally {
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
      }, 600);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        title="Upload a .zip containing emails (.eml/.txt/.md), letters (.pdf), master data (.csv/.json) or images (.jpg/.png/.webp). Conflicts are surfaced for review — you can revoke any item before they take effect."
        style={{
          height: 36,
          padding: "0 14px",
          background: uploading ? "var(--brand-wash)" : "var(--brand)",
          color: uploading ? "var(--brand)" : "white",
          border: "1px solid var(--brand)",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          cursor: uploading ? "default" : "pointer",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {uploading && (
          <span
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${progress}%`,
              background: "rgba(13,120,53,0.18)",
              transition: "width 200ms",
            }}
          />
        )}
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ position: "relative" }}>
          <path d="M8 11V3M5 6l3-3 3 3M3 12.5v.5a1 1 0 001 1h8a1 1 0 001-1v-.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ position: "relative" }}>{uploading ? "Ingesting…" : "Upload data"}</span>
      </button>
    </>
  );
}

// ── Result modal ─────────────────────────────────────────────────────────────

export function UploadResultModal({
  result,
  onClose,
  onInspect,
  onRevokeAll,
}: {
  result: UploadResult | null;
  onClose: () => void;
  onInspect: (entityId: string) => void;
  onRevokeAll?: () => void;
}) {
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [revoking, setRevoking] = useState<string | null>(null);

  if (!result) return null;

  const filesProcessed = result.files_processed ?? result.files_ingested ?? 0;

  const revokeFact = async (factId: string) => {
    setRevoking(factId);
    try {
      const r = await fetch("/api/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fact_id: factId }),
      });
      if (r.ok) {
        setRevoked((s) => new Set([...s, factId]));
      }
    } catch {
      /* ignore */
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 220,
        background: "rgba(28,26,22,0.42)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "6vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 820,
          maxWidth: "94%",
          background: "var(--bg)",
          borderRadius: 12,
          border: "1px solid var(--border-muted)",
          boxShadow: "0 24px 80px rgba(28,26,22,0.20)",
          overflow: "hidden",
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--brand)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            Upload complete
          </div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em" }}>
            Added{" "}
            <span style={{ color: "var(--brand)" }}>{result.facts_added}</span>{" "}
            {result.facts_added === 1 ? "fact" : "facts"} across{" "}
            <span style={{ color: "var(--brand)" }}>{result.entities_changed.length}</span>{" "}
            {result.entities_changed.length === 1 ? "entity" : "entities"}.
          </h2>
          <p
            style={{
              margin: "8px 0 0",
              fontSize: 13,
              color: "var(--fg-muted)",
              fontFamily: "var(--font-sans)",
            }}
          >
            <span className="mono">{filesProcessed}</span> of{" "}
            <span className="mono">{result.files_total}</span> files processed
            {result.files_skipped > 0 && (
              <> · <span className="mono">{result.files_skipped}</span> skipped</>
            )}
            {result.conflicts_found > 0 && (
              <>
                {" · "}
                <span className="mono" style={{ color: "var(--high)" }}>
                  {result.conflicts_found} conflict{result.conflicts_found === 1 ? "" : "s"}
                </span>
              </>
            )}
            {" · "}
            <span className="mono">{result.latency_ms}ms</span>
          </p>
        </div>

        {/* Conflicts — surfaced first since they need a decision */}
        {result.conflicts && result.conflicts.length > 0 && (
          <div
            style={{
              padding: "14px 24px 16px",
              borderBottom: "1px solid var(--border)",
              background: "var(--high-wash)",
              maxHeight: 280,
              overflow: "auto",
            }}
          >
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: "var(--high)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 8,
                fontWeight: 600,
              }}
            >
              ⚠ Conflicts with existing data — review or revoke each item
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {result.conflicts.map((c) => {
                const isRevoked = revoked.has(c.fact_id);
                const isPending = revoking === c.fact_id;
                return (
                  <div
                    key={c.fact_id}
                    style={{
                      padding: "10px 12px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      opacity: isRevoked ? 0.5 : 1,
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 12,
                      alignItems: "start",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: "var(--fg)", marginBottom: 4 }}>
                        <button
                          onClick={() => onInspect(c.entity)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            color: "var(--fg)",
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                          title="Inspect entity"
                        >
                          {c.entity_name}
                        </button>
                        <span className="mono" style={{ color: "var(--fg-dim)", fontSize: 10, marginLeft: 6 }}>
                          {c.predicate}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" }}>
                        {c.competing.map((p, i) => {
                          const isWinner = p.value === c.new_value;
                          return (
                            <span
                              key={i}
                              className="mono"
                              style={{
                                fontSize: 11,
                                padding: "2px 7px",
                                borderRadius: 4,
                                background: isWinner ? "var(--brand-wash)" : "var(--bg-elevated)",
                                color: isWinner ? "var(--brand)" : "var(--fg-muted)",
                                border: isWinner ? "1px solid var(--brand-line)" : "1px solid var(--border)",
                                textDecorationLine: isRevoked && isWinner ? "line-through" : "none",
                              }}
                            >
                              {p.value}
                              <span style={{ opacity: 0.6, marginLeft: 4 }}>
                                · {(p.probability * 100).toFixed(0)}%
                              </span>
                            </span>
                          );
                        })}
                      </div>
                      <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 4 }}>
                        new from <em>{c.source_title}</em>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                      {isRevoked ? (
                        <span
                          className="mono"
                          style={{ fontSize: 10, color: "var(--brand)", padding: "4px 10px" }}
                        >
                          ✓ revoked
                        </span>
                      ) : (
                        <button
                          onClick={() => revokeFact(c.fact_id)}
                          disabled={isPending}
                          style={{
                            padding: "5px 10px",
                            border: "1px solid var(--border-muted)",
                            background: "transparent",
                            color: "var(--severity-critical)",
                            borderRadius: 5,
                            fontSize: 11,
                            fontWeight: 500,
                            cursor: isPending ? "default" : "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {isPending ? "Revoking…" : "Revoke"}
                        </button>
                      )}
                      <button
                        onClick={() => onInspect(c.entity)}
                        style={{
                          padding: "5px 10px",
                          border: "1px solid var(--border-muted)",
                          background: "transparent",
                          color: "var(--fg)",
                          borderRadius: 5,
                          fontSize: 11,
                          fontWeight: 500,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Edit context →
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {onRevokeAll && (
              <button
                onClick={onRevokeAll}
                style={{
                  marginTop: 10,
                  padding: "5px 10px",
                  background: "transparent",
                  border: "1px solid var(--border-muted)",
                  color: "var(--severity-critical)",
                  borderRadius: 5,
                  fontSize: 11,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Revoke entire upload
              </button>
            )}
          </div>
        )}

        {/* Sample subjects */}
        {result.sample_subjects.length > 0 && (
          <div style={{ padding: "14px 24px 12px", borderBottom: "1px solid var(--border)" }}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: "var(--fg-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 6,
              }}
            >
              Sample subjects
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {result.sample_subjects.slice(0, 5).map((s, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 12.5,
                    color: "var(--fg-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  · {s}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Entity list */}
        <div style={{ padding: "16px 24px 18px", maxHeight: 320, overflow: "auto" }}>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 10,
            }}
          >
            Changed entities · click to inspect
          </div>
          {result.entities_changed.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
              No facts were extracted — every file was either skipped or rejected by the relevance gate.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {result.entities_changed.map((e) => (
                <button
                  key={e.id}
                  onClick={() => onInspect(e.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "20px 1fr 80px",
                    gap: 12,
                    padding: "9px 8px",
                    border: "none",
                    background: "transparent",
                    borderRadius: 6,
                    cursor: "pointer",
                    textAlign: "left",
                    color: "var(--fg)",
                    fontFamily: "inherit",
                    transition: "background 100ms",
                  }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-hover)")}
                  onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                >
                  <span
                    className="mono"
                    style={{ color: "var(--fg-muted)", fontSize: 14, textAlign: "center" }}
                  >
                    {ENTITY_GLYPH[e.type] ?? "·"}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--fg)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {e.name}
                    </div>
                    <div
                      className="mono"
                      style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 1 }}
                    >
                      {e.type} · {e.id}
                    </div>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--brand)",
                      textAlign: "right",
                      alignSelf: "center",
                    }}
                  >
                    +{e.fact_count} {e.fact_count === 1 ? "fact" : "facts"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 24px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            background: "var(--bg-elevated)",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "7px 14px",
              border: "1px solid var(--border-muted)",
              background: "transparent",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              color: "var(--fg)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
