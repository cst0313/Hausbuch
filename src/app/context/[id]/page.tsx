// path: src/app/context/[id]/page.tsx
"use client";

import { use, useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { FactProvenanceDrawer } from "@/components/FactProvenanceDrawer";
import { TimelineScrubber } from "@/components/TimelineScrubber";
import type { Fact, Source } from "@/lib/types";

type ContextResponse = {
  entity: string;
  markdown: string;
  facts: Fact[];
  sources: Source[];
  counts: { facts: number; sources: number; conflicts: number };
};

export default function ContextPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  let decoded: string;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    decoded = id;
  }
  const entity = decoded.includes(":") ? decoded : `weg:${decoded}`;

  const [data, setData] = useState<ContextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Fact | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  // Bitemporal valid-time we're rendering AT. null = "now". The TimelineScrubber
  // controls this; the renderer projects facts as they were on that date.
  const [atValid, setAtValid] = useState<string | null>(null);
  // Keep the FULL fact list separate from the projected `data` so the timeline
  // tick density doesn't change as the user scrubs. The slider wants to see
  // every fact ever written (its job is to navigate them); the page body wants
  // only the facts true at the chosen date.
  const [allFacts, setAllFacts] = useState<Fact[] | null>(null);

  // Initial load — pulls every live fact for this entity so the slider has the
  // full timeline to render.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/context/${encodeURIComponent(entity)}?format=json&detail=3`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ContextResponse) => {
        if (cancelled) return;
        setData(d);
        setAllFacts(d.facts);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [entity]);

  // Re-fetch the projected view whenever the user moves the slider. We don't
  // touch allFacts here so the timeline ticks stay stable.
  useEffect(() => {
    if (atValid === null) return;
    let cancelled = false;
    const url =
      `/api/context/${encodeURIComponent(entity)}` +
      `?format=json&detail=3&at_valid=${encodeURIComponent(atValid)}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ContextResponse) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [entity, atValid]);

  const buildingName = useMemo(() => {
    if (!data) return entity;
    const addr = data.facts.find((f) => f.predicate === "identity.address");
    const name = data.facts.find((f) => f.predicate === "identity.name");
    return String(name?.value ?? addr?.value ?? entity);
  }, [data, entity]);

  const selectedSource = useMemo(() => {
    if (!selected || !data) return null;
    return data.sources.find((s) => s.id === selected.source) ?? null;
  }, [selected, data]);

  return (
    <>
      <Nav />

      <main className="max-w-5xl mx-auto px-6 pt-12 pb-24 fade-up">
        {/* Header */}
        <header className="mb-8">
          {/*
            Back affordance — context pages are reached from /graph (clicking
            a node), /dashboard (rec rows), /audit (entity link), or directly.
            history.back() is the cheapest way to land the user back where
            they came from regardless of origin; if there is no referrer
            (deep-link landing) we fall back to /dashboard.
          */}
          <button
            onClick={() => {
              if (window.history.length > 1) window.history.back();
              else window.location.href = "/dashboard";
            }}
            className="inline-flex items-center gap-1.5 text-[12px] font-mono mb-3 px-2 py-1 rounded transition-colors"
            style={{
              color: "var(--fg-muted)",
              border: "1px solid var(--border-muted)",
              background: "transparent",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ← back
          </button>
          <p
            className="text-[11px] font-mono uppercase tracking-wider mb-3"
            style={{ color: "var(--fg-dim)" }}
          >
            Context.md · {entity.split(":")[0]}
          </p>
          <h1
            className="font-display"
            style={{
              fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)",
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              fontWeight: 500,
            }}
          >
            {buildingName}
          </h1>
          {data && (
            <div
              className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px]"
              style={{ color: "var(--fg-muted)" }}
            >
              <Stat n={data.counts.facts} label="facts" />
              <Stat n={data.counts.sources} label="sources" />
              {data.counts.conflicts > 0 && (
                <Stat n={data.counts.conflicts} label="conflicts" tone="warning" />
              )}
              <span className="font-mono text-[11px]" style={{ color: "var(--fg-dim)" }}>
                {data.entity}
              </span>
              <button
                onClick={() => setShowRaw((s) => !s)}
                className="ml-auto font-mono text-[11px] px-2 py-1 rounded border"
                style={{
                  borderColor: "var(--border-muted)",
                  color: showRaw ? "var(--brand)" : "var(--fg-muted)",
                  background: showRaw ? "var(--brand-wash)" : "transparent",
                  cursor: "pointer",
                }}
              >
                {showRaw ? "showing raw" : "view raw"}
              </button>
            </div>
          )}
        </header>

        {/* Time-travel slider — drives the bitemporal projection rendered below */}
        {data && (
          <div className="mb-10">
            <TimelineScrubber
              // Use the FULL fact list so tick density is stable while scrubbing;
              // the page below is what re-projects to the chosen date.
              facts={allFacts ?? data.facts}
              at={atValid ?? new Date().toISOString()}
              onChange={(iso) => setAtValid(iso)}
              onJumpToTick={(iso) => setAtValid(iso)}
            />
          </div>
        )}

        {error && (
          <p className="text-[13px] font-mono" style={{ color: "var(--danger)" }}>
            Failed to load: {error}
          </p>
        )}
        {!data && !error && <p style={{ color: "var(--fg-muted)" }}>Loading…</p>}

        {data && !showRaw && (
          <RenderedContext
            markdown={data.markdown}
            facts={data.facts}
            sources={data.sources}
            onSelectFact={setSelected}
          />
        )}

        {data && showRaw && (
          <pre
            className="mono"
            style={{
              padding: 20,
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--bg-elevated)",
              fontSize: 11.5,
              lineHeight: 1.55,
              color: "var(--fg)",
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {data.markdown}
          </pre>
        )}
      </main>

      <FactProvenanceDrawer
        fact={selected}
        source={selectedSource}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone?: "warning";
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span
        className="font-semibold tabular-nums"
        style={{ color: tone === "warning" ? "var(--warning)" : "var(--fg)" }}
      >
        {n}
      </span>
      <span className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
        {label}
      </span>
    </span>
  );
}

// ── Rendered (human-readable) view ───────────────────────────────────────────

type Segment =
  | { kind: "section"; title: string }
  | { kind: "fact"; ident: string; raw: string }
  | { kind: "conflict"; key: string; raw: string }
  | { kind: "blockquote"; text: string }
  | { kind: "footer"; text: string }
  | { kind: "blank" };

function parseMarkdown(md: string): Segment[] {
  const out: Segment[] = [];
  const factRe = /<!-- fact:([a-f0-9]+) -->\n?([\s\S]*?)\n?<!-- \/fact:\1 -->/g;
  const conflictRe = /<!-- conflict:([^ ]+?) -->\n?([\s\S]*?)\n?<!-- \/conflict:\1 -->/g;

  // Find all anchored ranges first so we can split the text around them.
  type Anchor = { start: number; end: number; node: Segment };
  const anchors: Anchor[] = [];
  let m: RegExpExecArray | null;
  while ((m = factRe.exec(md)) !== null) {
    anchors.push({
      start: m.index,
      end: m.index + m[0].length,
      node: { kind: "fact", ident: m[1], raw: m[2] },
    });
  }
  while ((m = conflictRe.exec(md)) !== null) {
    anchors.push({
      start: m.index,
      end: m.index + m[0].length,
      node: { kind: "conflict", key: m[1], raw: m[2] },
    });
  }
  anchors.sort((a, b) => a.start - b.start);

  let cursor = 0;
  const emitText = (text: string) => {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        out.push({ kind: "blank" });
      } else if (trimmed.startsWith("# ")) {
        out.push({ kind: "section", title: trimmed.slice(2) });
      } else if (trimmed.startsWith("## ")) {
        out.push({ kind: "section", title: trimmed.slice(3) });
      } else if (trimmed.startsWith("> ")) {
        out.push({ kind: "blockquote", text: trimmed.slice(2) });
      } else if (trimmed.startsWith("<!--") && trimmed.endsWith("-->")) {
        // The trailer "Hausbuch · N facts · ..." is a meta comment we surface
        // as a small footer. Other anonymous comments are skipped.
        const inner = trimmed.replace(/^<!--\s*/, "").replace(/\s*-->$/, "");
        if (inner.includes("Hausbuch") || inner.includes("facts")) {
          out.push({ kind: "footer", text: inner });
        }
      }
      // Non-fact mono lines (rare — only when the renderer emits something
      // outside an anchor) are skipped silently.
    }
  };

  for (const a of anchors) {
    if (a.start > cursor) emitText(md.slice(cursor, a.start));
    out.push(a.node);
    cursor = a.end;
  }
  if (cursor < md.length) emitText(md.slice(cursor));
  return out;
}

function RenderedContext({
  markdown,
  facts,
  sources,
  onSelectFact,
}: {
  markdown: string;
  facts: Fact[];
  sources: Source[];
  onSelectFact: (f: Fact) => void;
}) {
  const byIdent = useMemo(() => {
    const m = new Map<string, Fact>();
    for (const f of facts) m.set(f.ident, f);
    return m;
  }, [facts]);
  const sourceById = useMemo(() => {
    const m = new Map<string, Source>();
    for (const s of sources) m.set(s.id, s);
    return m;
  }, [sources]);

  const segments = useMemo(() => parseMarkdown(markdown), [markdown]);

  // Group consecutive fact/conflict segments inside each section so we render
  // them as a single table with consistent grid widths.
  type Block =
    | { kind: "section"; title: string }
    | { kind: "rows"; rows: Array<Extract<Segment, { kind: "fact" | "conflict" }>> }
    | { kind: "blockquote"; text: string }
    | { kind: "footer"; text: string };
  const blocks: Block[] = [];
  let buffer: Array<Extract<Segment, { kind: "fact" | "conflict" }>> = [];
  const flush = () => {
    if (buffer.length) {
      blocks.push({ kind: "rows", rows: buffer });
      buffer = [];
    }
  };
  for (const s of segments) {
    if (s.kind === "fact" || s.kind === "conflict") {
      buffer.push(s);
    } else if (s.kind === "section") {
      flush();
      blocks.push({ kind: "section", title: s.title });
    } else if (s.kind === "blockquote") {
      flush();
      blocks.push({ kind: "blockquote", text: s.text });
    } else if (s.kind === "footer") {
      flush();
      blocks.push({ kind: "footer", text: s.text });
    }
  }
  flush();

  return (
    <article style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {blocks.map((b, i) => {
        if (b.kind === "section") {
          return <SectionHeading key={i}>{b.title}</SectionHeading>;
        }
        if (b.kind === "rows") {
          return (
            <div
              key={i}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                background: "var(--bg-elevated)",
                overflow: "hidden",
              }}
            >
              {b.rows.map((row, ri) => {
                const last = ri === b.rows.length - 1;
                if (row.kind === "fact") {
                  const fact = byIdent.get(row.ident);
                  return (
                    <FactRow
                      key={ri}
                      raw={row.raw}
                      fact={fact}
                      sourceById={sourceById}
                      onClick={fact ? () => onSelectFact(fact) : undefined}
                      bordered={!last}
                    />
                  );
                }
                return <ConflictRow key={ri} raw={row.raw} bordered={!last} />;
              })}
            </div>
          );
        }
        if (b.kind === "blockquote") {
          return (
            <p
              key={i}
              className="serif-italic"
              style={{
                fontSize: 14,
                color: "var(--fg-muted)",
                paddingLeft: 14,
                borderLeft: "2px solid var(--border-muted)",
                margin: 0,
              }}
            >
              {b.text}
            </p>
          );
        }
        return (
          <p
            key={i}
            className="mono"
            style={{ fontSize: 11, color: "var(--fg-dim)", margin: 0 }}
          >
            {b.text}
          </p>
        );
      })}
    </article>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <h2
        style={{
          fontSize: 18,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: "var(--fg)",
          margin: 0,
        }}
      >
        {children}
      </h2>
      <span style={{ flex: 1, height: 1, background: "var(--border-muted)" }} />
    </div>
  );
}

// Parse a fact line "  predicate-name    value  ^[citation] · × N sources (also: …)"
type ParsedFactLine = {
  predicate: string;
  value: string;
  citation: string | null;
  corroboration: string | null;
};
function parseFactLine(raw: string): ParsedFactLine {
  // Citation suffix: take everything after the LAST "  ^[".
  const trimmed = raw.trim();
  const citeIdx = trimmed.lastIndexOf("^[");
  let head = trimmed;
  let citation: string | null = null;
  let corroboration: string | null = null;
  if (citeIdx >= 0) {
    head = trimmed.slice(0, citeIdx).trim();
    const tail = trimmed.slice(citeIdx + 2);
    const closeIdx = tail.indexOf("]");
    if (closeIdx >= 0) {
      citation = tail.slice(0, closeIdx);
      const rest = tail.slice(closeIdx + 1).trim();
      // " · × 5 sources (also: A; B)"
      const corroMatch = rest.match(/×\s*\d+\s*sources?[^\n]*/);
      if (corroMatch) corroboration = corroMatch[0];
    }
  }
  // head now looks like "predicate.name    value"
  // Split at the longest run of >= 2 spaces.
  const m = head.match(/^(\S+)\s{2,}(.+)$/);
  if (m) return { predicate: m[1], value: m[2].trim(), citation, corroboration };
  // Fallback: first whitespace as separator
  const parts = head.split(/\s+/);
  return {
    predicate: parts[0] ?? "",
    value: parts.slice(1).join(" "),
    citation,
    corroboration,
  };
}

function FactRow({
  raw,
  fact,
  sourceById,
  onClick,
  bordered,
}: {
  raw: string;
  fact: Fact | undefined;
  sourceById: Map<string, Source>;
  onClick?: () => void;
  bordered: boolean;
}) {
  const parsed = parseFactLine(raw);
  const src = fact ? sourceById.get(fact.source) : null;

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(190px, 1fr) minmax(180px, 1.4fr) auto",
        gap: 18,
        padding: "12px 18px",
        borderBottom: bordered ? "1px solid var(--border-muted)" : "none",
        cursor: onClick ? "pointer" : "default",
        alignItems: "baseline",
        transition: "background 100ms",
      }}
      onMouseEnter={(e) => {
        if (onClick) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (onClick) e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--fg-dim)",
          letterSpacing: "0.01em",
          textTransform: "lowercase",
        }}
      >
        {parsed.predicate}
      </span>
      <span
        style={{
          fontSize: 14,
          color: "var(--fg)",
          fontWeight: 500,
          letterSpacing: "-0.005em",
          wordBreak: "break-word",
        }}
      >
        {parsed.value}
        {fact?.valid_from && fact.valid_from !== fact.valid_to && (
          <span className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginLeft: 8 }}>
            {/*
              valid_to=null means "still true today". The previous render
              "2024-12-31 →" looked like a broken arrow with no target;
              spell it as "since 2024-12-31" so a non-technical reader
              understands it's an open-ended interval.
            */}
            {fact.valid_to
              ? `${fact.valid_from.slice(0, 10)} → ${fact.valid_to.slice(0, 10)}`
              : `since ${fact.valid_from.slice(0, 10)}`}
          </span>
        )}
      </span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        {parsed.citation && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--brand)",
              padding: "2px 8px",
              borderRadius: 999,
              background: "var(--brand-wash)",
              border: "1px solid var(--brand-line)",
              maxWidth: 220,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={src?.title ?? parsed.citation}
          >
            {parsed.citation}
          </span>
        )}
        {parsed.corroboration && (
          <span className="mono" style={{ fontSize: 9, color: "var(--fg-dim)" }}>
            {parsed.corroboration}
          </span>
        )}
      </div>
    </div>
  );
}

function ConflictRow({ raw, bordered }: { raw: string; bordered: boolean }) {
  // Conflict block format:
  //   key:  ⚠ conflict
  //     → value (eff. 2024-01-01)  ^[Source A]
  //     → value (eff. 2024-02-01)  ^[Source B]
  //     posterior: P(value)=0.x · P(value)=0.y
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const headLine = lines.find((l) => l.includes("conflict")) ?? lines[0];
  const claims = lines
    .filter((l) => l.startsWith("→ "))
    .map((l) => {
      const cite = l.match(/\^\[([^\]]+)\]/);
      const text = l.replace(/\s*\^\[[^\]]+\]\s*$/, "").replace(/^→\s*/, "");
      return { text, citation: cite?.[1] ?? null };
    });
  const posteriorLine = lines.find((l) => l.startsWith("posterior:"));
  const probabilities = posteriorLine
    ? Array.from(posteriorLine.matchAll(/P\(([^)]+)\)\s*=\s*([\d.]+)/g)).map((m) => ({
        value: m[1],
        p: Number(m[2]),
      }))
    : [];
  const predicateName = headLine.split(":")[0].trim();

  return (
    <div
      style={{
        padding: "14px 18px",
        borderBottom: bordered ? "1px solid var(--border-muted)" : "none",
        background: "rgba(180,83,9,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--fg-dim)" }}>
          {predicateName}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--high)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          ⚠ conflict
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {claims.map((c, i) => {
          const prob = probabilities[i]?.p ?? 0;
          return (
            <div key={i}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  fontSize: 13,
                  marginBottom: 4,
                }}
              >
                <span style={{ color: "var(--fg)", fontWeight: 500 }}>{c.text}</span>
                {prob > 0 && (
                  <span
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: prob >= 0.5 ? "var(--brand)" : "var(--fg-muted)",
                    }}
                  >
                    P = {prob.toFixed(2)}
                  </span>
                )}
              </div>
              <div
                style={{
                  height: 6,
                  background: "var(--bg)",
                  borderRadius: 3,
                  overflow: "hidden",
                  border: "1px solid var(--border-muted)",
                }}
              >
                <div
                  style={{
                    width: `${Math.max(0, Math.min(1, prob)) * 100}%`,
                    height: "100%",
                    background: prob >= 0.5 ? "var(--brand)" : "var(--fg-dim)",
                    transition: "width 240ms ease-out",
                  }}
                />
              </div>
              {c.citation && (
                <span
                  className="mono"
                  style={{ fontSize: 10, color: "var(--brand)", marginTop: 4, display: "inline-block" }}
                >
                  ^[{c.citation}]
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
