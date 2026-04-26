// path: src/components/FactProvenanceDrawer.tsx
"use client";

import { useEffect, useState } from "react";
import type { Fact, Source } from "@/lib/types";
import { PdfHighlightView } from "./PdfHighlightView";

type Props = {
  fact: Fact | null;
  source: Source | null;
  onClose: () => void;
};

export function FactProvenanceDrawer({ fact, source, onClose }: Props) {
  // ESC to close
  useEffect(() => {
    if (!fact) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fact, onClose]);

  // The source the drawer is *currently displaying*. Defaults to the source
  // the fact was extracted from; clicking a sibling in the thread overrides
  // it to that one. The fact itself never changes — we still highlight the
  // fact's quote inside whichever source is on screen.
  const [viewedSource, setViewedSource] = useState<Source | null>(null);
  // Reset to the original source whenever the parent opens the drawer for
  // a different fact.
  useEffect(() => {
    setViewedSource(null);
  }, [fact?.id, source?.id]);

  const navigate = (sourceId: string) => {
    if (sourceId === source?.id) {
      setViewedSource(null);
      return;
    }
    fetch(`/api/source/${encodeURIComponent(sourceId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { source: Source }) => setViewedSource(d.source))
      .catch(() => {});
  };

  const displaySource = viewedSource ?? source;
  const isOnOriginal = !viewedSource;

  const open = fact !== null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-40 transition-opacity"
        style={{
          background: "rgba(0,0,0,0.45)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transitionDuration: "200ms",
        }}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Fact provenance"
        className="fixed right-0 top-0 bottom-0 z-50 w-full md:w-[420px] overflow-y-auto transition-transform"
        style={{
          background: "var(--bg-elevated)",
          borderLeft: "1px solid var(--border)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transitionTimingFunction: "cubic-bezier(0.4,0,0.2,1)",
          transitionDuration: "250ms",
        }}
      >
        {fact && (
          <div className="p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p
                  className="text-[11px] font-mono uppercase tracking-wider mb-1"
                  style={{ color: "var(--fg-dim)" }}
                >
                  provenance
                </p>
                <h2
                  className="text-[18px] font-semibold tracking-tight"
                  style={{ color: "var(--fg)", letterSpacing: "-0.01em" }}
                >
                  {fact.predicate}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="h-8 w-8 rounded-md flex items-center justify-center transition-colors hover:bg-[color:var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]"
                style={{ color: "var(--fg-muted)" }}
              >
                ✕
              </button>
            </div>

            {/* Value */}
            <Row label="value">
              <span className="font-medium" style={{ color: "var(--fg)" }}>
                {String(fact.value)}
                {fact.unit && (
                  <span
                    className="ml-1 text-[12px]"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    {fact.unit}
                  </span>
                )}
              </span>
            </Row>

            <Row label="confidence">
              <ConfidenceBar value={fact.confidence} />
            </Row>

            {/* Bitemporal */}
            <Row label="valid time">
              <span className="font-mono text-[13px]" style={{ color: "var(--fg)" }}>
                {fact.valid_from ?? "—"} → {fact.valid_to ?? "open"}
              </span>
            </Row>
            <Row label="known time">
              <span className="font-mono text-[13px]" style={{ color: "var(--fg)" }}>
                {fact.known_from} → {fact.known_to ?? "open"}
              </span>
            </Row>

            {fact.superseded_by && (
              <Row label="superseded by">
                <span className="font-mono text-[12px]" style={{ color: "var(--warning)" }}>
                  {fact.superseded_by}
                </span>
              </Row>
            )}

            {/* Source */}
            <div
              className="mt-6 pt-6 border-t"
              style={{ borderColor: "var(--border)" }}
            >
              <p
                className="text-[11px] font-mono uppercase tracking-wider mb-3"
                style={{ color: "var(--fg-dim)" }}
              >
                source
              </p>
              {displaySource ? (
                <>
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <p
                      className="text-[14px] font-medium"
                      style={{ color: "var(--fg)" }}
                    >
                      {displaySource.title}
                    </p>
                    {!isOnOriginal && source && (
                      <button
                        type="button"
                        onClick={() => setViewedSource(null)}
                        className="font-mono text-[10px] px-2 py-0.5 rounded transition-colors hover:opacity-80"
                        style={{
                          color: "var(--brand)",
                          background: "var(--brand-wash)",
                          border: "1px solid var(--brand)",
                          cursor: "pointer",
                        }}
                        title="Back to the source the fact was extracted from"
                      >
                        ← back to fact source
                      </button>
                    )}
                  </div>
                  <p
                    className="text-[11px] font-mono mb-4"
                    style={{ color: "var(--fg-dim)" }}
                  >
                    {displaySource.kind} · ingested {displaySource.ingested_at}
                    {!isOnOriginal && source && ` · viewing thread sibling of ${source.title}`}
                  </p>
                  {/*
                    Source preview. Three render paths:
                      • PDF (kind = letter/invoice/pdf) → fetch the actual
                        bytes and render the page with the highlight rect
                        drawn on top via PdfHighlightView.
                      • Email (kind = email) → render the extraction-span
                        preview AND the rest of the thread so the user can
                        navigate the whole conversation.
                      • Anything else (note, bank, stammdaten) → just the
                        text-based ExtractionPreview.
                  */}
                  {(["letter", "invoice", "pdf"].includes(displaySource.kind)) ? (
                    <PdfSourcePreview source={displaySource} fact={fact} />
                  ) : displaySource.kind === "email" ? (
                    <>
                      <ExtractionPreview source={displaySource} fact={fact} />
                      <ThreadView
                        sourceId={displaySource.id}
                        onSelect={navigate}
                      />
                    </>
                  ) : displaySource.kind === "bank" ? (
                    <BankStatementPreview source={displaySource} fact={fact} />
                  ) : (
                    <ExtractionPreview source={displaySource} fact={fact} />
                  )}

                  {fact.span && isOnOriginal && (
                    <div
                      className="mt-3 text-[11px] font-mono"
                      style={{ color: "var(--fg-dim)" }}
                    >
                      span [{fact.span.start}:{fact.span.end}] · source_prior{" "}
                      {displaySource.source_prior.toFixed(2)}
                    </div>
                  )}
                </>
              ) : (
                <p style={{ color: "var(--fg-muted)" }}>Source not found.</p>
              )}
            </div>

            {/* Fact id (dev helper) */}
            <div
              className="mt-6 pt-4 border-t text-[10px] font-mono"
              style={{ borderColor: "var(--border)", color: "var(--fg-dim)" }}
            >
              {fact.id}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2.5 flex items-start justify-between gap-4 border-b"
      style={{ borderColor: "var(--border)" }}>
      <span
        className="text-[11px] font-mono uppercase tracking-wider shrink-0"
        style={{ color: "var(--fg-dim)" }}
      >
        {label}
      </span>
      <span className="text-right text-[13px]">{children}</span>
    </div>
  );
}

/**
 * Show the source's raw text with the exact extraction span highlighted.
 *
 * Strategy: locate the fact's span.quote inside source.raw_excerpt, then
 * window the surrounding text (±220 chars) so the user sees a few sentences
 * of context around the highlight without scrolling through the whole doc.
 *
 * If the quote can't be located in the excerpt — e.g. the excerpt was
 * truncated before the span, or the source is the whole PDF and the span
 * indices reference the original text — we fall back to rendering the
 * quote on its own with a "from {source.kind}" label so the user still
 * sees what was extracted, just without context around it.
 */
function ExtractionPreview({ source, fact }: { source: Source; fact: Fact }) {
  const body = source.raw_excerpt ?? "";
  const quote = (fact.span?.quote ?? "").trim();

  let before = "";
  let highlight = quote;
  let after = "";

  // Try the span indices first (they're reliable when extraction kept them);
  // otherwise locate the quote substring directly.
  let idx = -1;
  if (
    fact.span &&
    typeof fact.span.start === "number" &&
    fact.span.start >= 0 &&
    fact.span.start < body.length &&
    body.slice(fact.span.start, fact.span.end) === quote
  ) {
    idx = fact.span.start;
  } else if (quote) {
    idx = body.indexOf(quote);
  }

  const CONTEXT = 220;
  if (idx >= 0 && quote) {
    const start = Math.max(0, idx - CONTEXT);
    const end = Math.min(body.length, idx + quote.length + CONTEXT);
    before = (start > 0 ? "…" : "") + body.slice(start, idx);
    highlight = body.slice(idx, idx + quote.length);
    after = body.slice(idx + quote.length, end) + (end < body.length ? "…" : "");
  } else {
    // Quote not in excerpt — show the quote on its own and prefix the body
    // for orientation.
    before = body.slice(0, 200) + (body.length > 200 ? "…" : "");
    highlight = quote || "(no quote captured)";
    after = "";
  }

  return (
    <div
      className="rounded-md p-3 text-[12.5px] leading-[1.55]"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border-muted)",
        color: "var(--fg-muted)",
        fontFamily: "var(--font-sans)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxHeight: 280,
        overflowY: "auto",
      }}
    >
      <div
        className="text-[10px] font-mono uppercase tracking-wider mb-2"
        style={{ color: "var(--fg-dim)" }}
      >
        extraction span
      </div>
      <span>{before}</span>
      <mark
        style={{
          background: "color-mix(in srgb, var(--brand) 28%, transparent)",
          color: "var(--fg)",
          padding: "1px 3px",
          borderRadius: 3,
          // soft ring to make the highlight stand out on busy text
          boxShadow:
            "0 0 0 1px color-mix(in srgb, var(--brand) 55%, transparent)",
        }}
      >
        {highlight}
      </mark>
      <span>{after}</span>
    </div>
  );
}

/**
 * Render the original PDF page(s) with the extraction span highlighted on
 * top. Fetches /api/source/<id>/pdf for the bytes; falls back to the text
 * ExtractionPreview if the PDF can't be located on disk.
 */
function PdfSourcePreview({ source, fact }: { source: Source; fact: Fact }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/source/${encodeURIComponent(source.id)}/pdf`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.error ?? `HTTP ${r.status}`);
        }
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        setFile(new File([blob], `${source.title}.pdf`, { type: "application/pdf" }));
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [source.id, source.title]);

  if (error) {
    return (
      <>
        <div
          className="text-[11px] font-mono mb-2"
          style={{ color: "var(--fg-dim)" }}
        >
          PDF unavailable ({error}) — showing extracted text instead
        </div>
        <ExtractionPreview source={source} fact={fact} />
      </>
    );
  }
  if (!file) {
    return (
      <div
        className="rounded-md p-3 text-[12px]"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border-muted)",
          color: "var(--fg-dim)",
        }}
      >
        loading PDF…
      </div>
    );
  }
  const quote = (fact.span?.quote ?? "").trim();
  return (
    <div
      style={{
        border: "1px solid var(--border-muted)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <div
        className="text-[10px] font-mono uppercase tracking-wider px-3 py-2"
        style={{
          color: "var(--fg-dim)",
          background: "var(--bg-elevated)",
          borderBottom: "1px solid var(--border-muted)",
        }}
      >
        extraction span · highlighted on the original page
      </div>
      <div style={{ maxHeight: 480, overflowY: "auto" }}>
        <PdfHighlightView
          file={file}
          spans={[{ predicate: fact.predicate, quote, value: String(fact.value ?? "") }]}
          hovered={quote}
        />
      </div>
    </div>
  );
}

/**
 * Render the rest of the email thread the source belongs to. Each row
 * shows the timestamp, direction (incoming / outgoing), subject, and a
 * short excerpt. Clicking a row navigates the drawer to that source —
 * the same fact stays "the fact under investigation", we just show it
 * inside a different message in the same thread.
 */
function ThreadView({
  sourceId,
  onSelect,
}: {
  sourceId: string;
  onSelect: (id: string) => void;
}) {
  type ThreadEntry = {
    id: string;
    title: string;
    ingested_at: string;
    direction: string | null;
    from_addr: string | null;
    to_addr: string | null;
    excerpt: string;
  };
  const [thread, setThread] = useState<{ thread_id: string | null; sources: ThreadEntry[] } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/source/${encodeURIComponent(sourceId)}/thread`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setThread(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  if (!thread || thread.sources.length <= 1) return null;
  return (
    <div className="mt-4">
      <div
        className="text-[10px] font-mono uppercase tracking-wider mb-2"
        style={{ color: "var(--fg-dim)" }}
      >
        thread · {thread.sources.length} message{thread.sources.length === 1 ? "" : "s"}
      </div>
      <ol
        className="space-y-2"
        style={{ listStyle: "none", margin: 0, padding: 0 }}
      >
        {thread.sources.map((m) => {
          const isCurrent = m.id === sourceId;
          const isOutgoing = m.direction === "outgoing";
          return (
            <li key={m.id} style={{ listStyle: "none", margin: 0, padding: 0 }}>
              <button
                type="button"
                onClick={() => onSelect(m.id)}
                className="w-full text-left rounded-md p-2.5 text-[12px] transition-colors"
                style={{
                  background: isCurrent
                    ? "color-mix(in srgb, var(--brand) 12%, transparent)"
                    : "var(--bg)",
                  border: `1px solid ${isCurrent ? "var(--brand)" : "var(--border-muted)"}`,
                  color: "var(--fg-muted)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "block",
                }}
                onMouseEnter={(e) => {
                  if (!isCurrent) {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isCurrent) {
                    e.currentTarget.style.background = "var(--bg)";
                    e.currentTarget.style.borderColor = "var(--border-muted)";
                  }
                }}
                aria-label={`Open ${m.title}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="font-mono text-[10px]"
                    style={{
                      color: isOutgoing ? "var(--brand)" : "var(--fg-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {isOutgoing ? "→ outgoing" : "← incoming"}
                  </span>
                  <span
                    className="font-mono text-[10px]"
                    style={{ color: "var(--fg-dim)" }}
                  >
                    {m.ingested_at.slice(0, 10)}
                  </span>
                  {isCurrent ? (
                    <span
                      className="font-mono text-[9px] px-1.5 py-0.5 rounded"
                      style={{
                        background: "var(--brand)",
                        color: "white",
                        letterSpacing: "0.04em",
                      }}
                    >
                      THIS
                    </span>
                  ) : (
                    <span
                      className="font-mono text-[9px] ml-auto"
                      style={{ color: "var(--fg-dim)" }}
                    >
                      open →
                    </span>
                  )}
                </div>
                <div
                  style={{ color: "var(--fg)", fontWeight: 500, marginBottom: 4 }}
                >
                  {m.title}
                </div>
                <div style={{ fontSize: 11.5, lineHeight: 1.45 }}>
                  {m.excerpt.replace(/\s+/g, " ")}
                  {m.excerpt.length >= 240 ? "…" : ""}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Bank-statement preview. For bank-transaction sources (id like
 * "src:bank:TX-00123") fetch the corresponding row from the live
 * Sparkasse-format kontoauszug CSV plus ±5 surrounding rows, then
 * render them as a small spreadsheet with the focus row highlighted
 * in brand color. So a citation like ^[↓ Miete 01/2024 EH-045] now
 * resolves visually to the actual line in the statement document
 * (with the rows above and below for context).
 *
 * Falls back to the text ExtractionPreview if the statement isn't on
 * disk or this source isn't tied to a TX reference.
 */
function BankStatementPreview({
  source,
  fact,
}: {
  source: Source;
  fact: Fact;
}) {
  type Row = {
    date: string;
    buchungstext: string;
    verwendungszweck: string;
    kundenreferenz: string;
    beguenstigter: string;
    iban: string;
    betrag: string;
    saldo: string;
    lineno: number;
    isFocus: boolean;
  };
  type Payload = {
    tx: string;
    statement: { file: string; total_rows: number; window: { start: number; end: number; focus: number } };
    rows: Row[];
  };
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/source/${encodeURIComponent(source.id)}/statement`)
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.error ?? `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d: Payload) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message ?? e));
      });
    return () => {
      cancelled = true;
    };
  }, [source.id]);

  if (error) {
    return (
      <>
        <div
          className="text-[11px] font-mono mb-2"
          style={{ color: "var(--fg-dim)" }}
        >
          Statement document unavailable ({error}) — showing extracted text instead
        </div>
        <ExtractionPreview source={source} fact={fact} />
      </>
    );
  }
  if (!data) {
    return (
      <div
        className="rounded-md p-3 text-[12px]"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border-muted)",
          color: "var(--fg-dim)",
        }}
      >
        loading bank statement…
      </div>
    );
  }
  return (
    <div
      style={{
        border: "1px solid var(--border-muted)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <div
        className="text-[10px] font-mono uppercase tracking-wider px-3 py-2"
        style={{
          color: "var(--fg-dim)",
          background: "var(--bg-elevated)",
          borderBottom: "1px solid var(--border-muted)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span>{data.statement.file}</span>
        <span>
          {data.tx} · row {data.statement.window.focus + 1} of {data.statement.total_rows}
        </span>
      </div>
      <div style={{ overflowX: "auto", maxHeight: 360 }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          <thead>
            <tr
              style={{
                background: "var(--bg-elevated)",
                color: "var(--fg-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              <th style={th()}>#</th>
              <th style={th()}>Datum</th>
              <th style={th()}>Buchungstext</th>
              <th style={th()}>Verwendungszweck</th>
              <th style={th()}>Begünstigter</th>
              <th style={{ ...th(), textAlign: "right" }}>Betrag</th>
              <th style={{ ...th(), textAlign: "right" }}>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr
                key={r.lineno}
                style={{
                  background: r.isFocus
                    ? "color-mix(in srgb, var(--brand) 22%, transparent)"
                    : "transparent",
                  borderTop: "1px solid var(--border-muted)",
                  color: r.isFocus ? "var(--fg)" : "var(--fg-muted)",
                  outline: r.isFocus
                    ? "1px solid color-mix(in srgb, var(--brand) 70%, transparent)"
                    : "none",
                }}
                title={
                  r.isFocus
                    ? `Source row for ${data.tx} (kundenreferenz=${r.kundenreferenz})`
                    : undefined
                }
              >
                <td style={td()}>{r.lineno}</td>
                <td style={td()}>{r.date}</td>
                <td style={td()}>{r.buchungstext}</td>
                <td style={{ ...td(), maxWidth: 220, whiteSpace: "normal" }}>
                  {r.verwendungszweck}
                </td>
                <td style={td()}>{r.beguenstigter}</td>
                <td style={{ ...td(), textAlign: "right" }}>{r.betrag}</td>
                <td style={{ ...td(), textAlign: "right" }}>{r.saldo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function th(): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "6px 10px",
    fontSize: 10,
    fontWeight: 500,
    borderBottom: "1px solid var(--border-muted)",
    whiteSpace: "nowrap",
  };
}

function td(): React.CSSProperties {
  return {
    padding: "6px 10px",
    whiteSpace: "nowrap",
    fontFeatureSettings: '"tnum"',
  };
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.8
      ? "var(--success)"
      : value >= 0.5
        ? "var(--brand-tint)"
        : "var(--warning)";
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="w-16 h-1 rounded-full overflow-hidden"
        style={{ background: "var(--border-muted)" }}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
      <span className="font-mono text-[12px]" style={{ color: "var(--fg)" }}>
        {pct}%
      </span>
    </span>
  );
}
