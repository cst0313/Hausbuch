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
  const entity = id.startsWith("property:") ? id : `property:${id}`;

  const [data, setData] = useState<ContextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Fact | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/context/${encodeURIComponent(entity)}?format=json&detail=3`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ContextResponse) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [entity]);

  const buildingName = useMemo(() => {
    if (!data) return entity;
    const addr = data.facts.find((f) => f.predicate === "identity.address");
    return addr ? String(addr.value) : entity;
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
          <p
            className="text-[11px] font-mono uppercase tracking-wider mb-3"
            style={{ color: "var(--fg-dim)" }}
          >
            Context.md
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
                <Stat
                  n={data.counts.conflicts}
                  label="conflicts"
                  tone="warning"
                />
              )}
              <span
                className="font-mono text-[11px]"
                style={{ color: "var(--fg-dim)" }}
              >
                entity · {data.entity}
              </span>
            </div>
          )}
        </header>

        {/* Skeleton Timeline (Phase 3 makes it interactive) */}
        {data && (
          <div className="mb-10">
            <TimelineScrubber facts={data.facts} at={new Date().toISOString()} />
          </div>
        )}

        {/* Body */}
        {error && (
          <p
            className="text-[13px] font-mono"
            style={{ color: "var(--danger)" }}
          >
            Failed to load: {error}
          </p>
        )}

        {!data && !error && (
          <p style={{ color: "var(--fg-muted)" }}>Loading…</p>
        )}

        {data && (
          <article
            className="rounded-lg border p-6 md:p-8"
            style={{
              borderColor: "var(--border)",
              background: "var(--bg-elevated)",
            }}
          >
            <InteractiveContextMarkdown
              markdown={data.markdown}
              facts={data.facts}
              onSelectFact={setSelected}
            />
          </article>
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

/**
 * Parse the rendered Context.md and make each `<!-- fact:IDENT -->...<!-- /fact:IDENT -->`
 * block clickable. Preserves the HTML-comment anchors in the output (they render as
 * invisible on screen but are the contract for surgical patches downstream).
 */
function InteractiveContextMarkdown({
  markdown,
  facts,
  onSelectFact,
}: {
  markdown: string;
  facts: Fact[];
  onSelectFact: (fact: Fact) => void;
}) {
  const byIdent = useMemo(() => {
    const m = new Map<string, Fact>();
    for (const f of facts) m.set(f.ident, f);
    return m;
  }, [facts]);

  // Split markdown by the fact anchor comments. Preserve raw text outside anchors.
  const segments = useMemo(() => {
    const out: Array<
      | { kind: "text"; text: string }
      | { kind: "fact"; ident: string; inner: string }
    > = [];
    const re = /<!-- fact:([a-f0-9]+) -->([\s\S]*?)<!-- \/fact:\1 -->/g;
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(markdown)) !== null) {
      if (m.index > cursor) {
        out.push({ kind: "text", text: markdown.slice(cursor, m.index) });
      }
      out.push({ kind: "fact", ident: m[1], inner: m[2] });
      cursor = m.index + m[0].length;
    }
    if (cursor < markdown.length) {
      out.push({ kind: "text", text: markdown.slice(cursor) });
    }
    return out;
  }, [markdown]);

  return (
    <div className="text-[14px] leading-relaxed" style={{ color: "var(--fg)" }}>
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return <RenderText key={i} text={seg.text} />;
        }
        const fact = byIdent.get(seg.ident);
        return (
          <FactLine
            key={i}
            text={seg.inner}
            onClick={fact ? () => onSelectFact(fact) : undefined}
          />
        );
      })}
    </div>
  );
}

/**
 * Minimal markdown renderer for the subset the renderer emits:
 *  - h1 / h2 / h3
 *  - > blockquote
 *  - plain paragraphs (single line each)
 * For Phase 1.5 we render the raw text in a stable, readable way. A proper
 * markdown parser can land later if the renderer grows richer output.
 */
function RenderText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />;
        if (line.startsWith("# ")) {
          return (
            <h2
              key={i}
              className="mt-6 mb-2 text-[18px] font-semibold tracking-tight"
              style={{ color: "var(--fg)", letterSpacing: "-0.01em" }}
            >
              {line.slice(2)}
            </h2>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h3
              key={i}
              className="mt-5 mb-2 text-[13px] font-mono uppercase tracking-wider"
              style={{ color: "var(--fg-dim)" }}
            >
              {line.slice(3)}
            </h3>
          );
        }
        if (line.startsWith("> ")) {
          return (
            <p
              key={i}
              className="italic pl-3 border-l my-2 text-[13px]"
              style={{
                borderColor: "var(--border-muted)",
                color: "var(--fg-muted)",
                fontFamily: "var(--font-serif)",
              }}
            >
              {line.slice(2)}
            </p>
          );
        }
        return (
          <p key={i} className="py-0.5 font-mono text-[13px]">
            {line}
          </p>
        );
      })}
    </>
  );
}

/**
 * One anchored fact block. Clickable — opens the provenance drawer.
 */
function FactLine({
  text,
  onClick,
}: {
  text: string;
  onClick?: () => void;
}) {
  const trimmed = text.trim();
  const canClick = Boolean(onClick);
  return (
    <div
      role={canClick ? "button" : undefined}
      tabIndex={canClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        canClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={`group flex items-start gap-2 -mx-2 px-2 py-1 rounded transition-colors font-mono text-[13px] ${
        canClick
          ? "cursor-pointer hover:bg-[color:var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]"
          : ""
      }`}
    >
      <span className="flex-1" style={{ color: "var(--fg)" }}>
        {trimmed}
      </span>
      {canClick && (
        <span
          className="shrink-0 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--brand-tint)" }}
          aria-hidden
        >
          details →
        </span>
      )}
    </div>
  );
}
