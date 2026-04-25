// path: src/app/audit/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { Nav } from "@/components/Nav";
import Link from "next/link";

type Action = {
  id: string; ts: string; actor: string; action: string;
  entity: string | null; target: string | null;
  input: unknown; output: unknown;
  latency_ms: number | null; cost_tokens: number | null;
  cost_usd: number | null; partner: string | null;
};

const ACTOR_COLORS: Record<string, string> = {
  user: "#0d7835",
  ingest: "#0c4a6e",
  gemini: "#7c3aed",
  tavily: "#b45309",
  reconciler: "#78716c",
  system: "#44403c",
};

export default function AuditPage() {
  const [actions, setActions] = useState<Action[]>([]);
  const [filter, setFilter] = useState<{ actor?: string; entity?: string }>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter.actor) params.set("actor", filter.actor);
    if (filter.entity) params.set("entity", filter.entity);
    params.set("limit", "200");
    const res = await fetch(`/api/audit?${params}`);
    const data = await res.json();
    setActions(data.actions ?? []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const actors = [...new Set(actions.map(a => a.actor))].sort();

  return (
    <>
      <Nav />
      <main className="max-w-6xl mx-auto px-6 pt-16 pb-24 fade-up">
        <header className="mb-8">
          <h1
            className="font-display"
            style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)", lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 500 }}
          >
            Audit Log
          </h1>
          <p className="mt-2 text-[14px]" style={{ color: "var(--fg-muted)" }}>
            Jede Aktion des Systems — transparent und nachvollziehbar. Kein stiller Arbeitsschritt.
          </p>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setFilter({})}
            className="px-3 py-1 rounded text-[11px] font-mono"
            style={{
              background: !filter.actor ? "var(--fg)" : "var(--bg-hover)",
              color: !filter.actor ? "var(--bg)" : "var(--fg-muted)",
            }}
          >
            Alle
          </button>
          {actors.map(a => (
            <button
              key={a}
              onClick={() => setFilter(f => ({ ...f, actor: f.actor === a ? undefined : a }))}
              className="px-3 py-1 rounded text-[11px] font-mono"
              style={{
                background: filter.actor === a ? ACTOR_COLORS[a] ?? "var(--fg-dim)" : "var(--bg-hover)",
                color: filter.actor === a ? "white" : "var(--fg-muted)",
              }}
            >
              {a}
            </button>
          ))}
        </div>

        {loading && <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>Lade...</p>}

        {/* Action list */}
        <div className="space-y-1">
          {actions.map(a => (
            <div
              key={a.id}
              className="rounded border transition-colors"
              style={{ borderColor: expanded.has(a.id) ? "var(--border-muted)" : "transparent", background: expanded.has(a.id) ? "var(--bg-elevated)" : "transparent" }}
            >
              <button
                onClick={() => toggle(a.id)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[color:var(--bg-hover)] rounded transition-colors"
              >
                <span className="text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
                  {new Date(a.ts).toISOString().slice(11, 19)}
                </span>
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: (ACTOR_COLORS[a.actor] ?? "#666") + "20", color: ACTOR_COLORS[a.actor] ?? "var(--fg-dim)" }}
                >
                  {a.actor}
                </span>
                <span className="text-[12px] font-mono" style={{ color: "var(--fg)" }}>
                  {a.action}
                </span>
                {a.entity && (
                  <Link
                    href={`/context/${encodeURIComponent(a.entity)}`}
                    className="text-[10px] font-mono hover:underline"
                    style={{ color: "var(--fg-dim)" }}
                    onClick={e => e.stopPropagation()}
                  >
                    {a.entity}
                  </Link>
                )}
                {a.latency_ms != null && (
                  <span className="ml-auto text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
                    {a.latency_ms}ms
                  </span>
                )}
                {a.partner && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--brand-wash)", color: "var(--brand)" }}>
                    {a.partner}
                  </span>
                )}
              </button>

              {expanded.has(a.id) && (
                <div className="px-4 pb-3 space-y-2">
                  {a.input && (
                    <div>
                      <div className="text-[10px] font-mono mb-1" style={{ color: "var(--fg-dim)" }}>INPUT</div>
                      <pre className="text-[11px] p-2 rounded overflow-x-auto" style={{ background: "var(--bg)", color: "var(--fg-muted)" }}>
                        {JSON.stringify(a.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  {a.output && (
                    <div>
                      <div className="text-[10px] font-mono mb-1" style={{ color: "var(--fg-dim)" }}>OUTPUT</div>
                      <pre className="text-[11px] p-2 rounded overflow-x-auto" style={{ background: "var(--bg)", color: "var(--fg-muted)" }}>
                        {JSON.stringify(a.output, null, 2)}
                      </pre>
                    </div>
                  )}
                  <div className="flex gap-4 text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
                    <span>ID: {a.id}</span>
                    {a.cost_tokens && <span>Tokens: {a.cost_tokens}</span>}
                    {a.cost_usd && <span>Cost: ${a.cost_usd.toFixed(6)}</span>}
                    {a.target && <span>Target: {a.target}</span>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {actions.length === 0 && !loading && (
          <p className="text-[13px]" style={{ color: "var(--fg-dim)" }}>
            Noch keine Aktionen aufgezeichnet. Aktionen werden bei Ingest, Abfragen und Genehmigungen protokolliert.
          </p>
        )}
      </main>
    </>
  );
}
