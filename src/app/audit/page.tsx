// path: src/app/audit/page.tsx
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Nav } from "@/components/Nav";
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";

type Action = {
  id: string; ts: string; actor: string; action: string;
  entity: string | null; target: string | null;
  input: unknown; output: unknown;
  latency_ms: number | null; cost_tokens: number | null;
  cost_usd: number | null; partner: string | null;
};

type Stream = {
  target: string;
  entity: string | null;
  first_at: string;
  last_at: string;
  steps: Action[];
};

type View = "flat" | "stream";

const ACTOR_COLORS: Record<string, string> = {
  user: "#0d7835",
  ingest: "#0c4a6e",
  gemini: "#7c3aed",
  tavily: "#b45309",
  cala: "#1d4ed8",
  reconciler: "#78716c",
  system: "#44403c",
};

export default function AuditPage() {
  const { t } = useLocale();
  const [actions, setActions] = useState<Action[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [filter, setFilter] = useState<{ actor?: string; entity?: string }>({});
  const [view, setView] = useState<View>("flat");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Debounce search input so we don't fire on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter.actor) params.set("actor", filter.actor);
    if (filter.entity) params.set("entity", filter.entity);
    if (debouncedQuery) params.set("q", debouncedQuery);
    params.set("view", view);
    params.set("limit", view === "stream" ? "500" : "200");
    const res = await fetch(`/api/audit?${params}`);
    const data = await res.json();
    if (view === "stream") {
      setStreams(data.streams ?? []);
      setActions([]);
    } else {
      setActions(data.actions ?? []);
      setStreams([]);
    }
    setLoading(false);
  }, [filter, debouncedQuery, view]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const actors = useMemo(() => {
    const all = view === "stream"
      ? streams.flatMap((s) => s.steps).map((a) => a.actor)
      : actions.map((a) => a.actor);
    return [...new Set(all)].sort();
  }, [view, actions, streams]);

  const totalSteps = useMemo(
    () => (view === "stream" ? streams.reduce((n, s) => n + s.steps.length, 0) : actions.length),
    [view, actions, streams],
  );

  return (
    <>
      <Nav />
      <main className="max-w-6xl mx-auto px-6 pt-16 pb-24 fade-up">
        <header className="mb-8">
          <h1
            className="font-display"
            style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)", lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 500 }}
          >
            {t("audit.heading")}
          </h1>
          <p className="mt-2 text-[14px]" style={{ color: "var(--fg-muted)" }}>
            {t("audit.subtitle")}
          </p>
        </header>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("audit.search.placeholder")}
            className="w-full px-3 py-2 text-[13px] rounded border focus:outline-none focus:ring-1"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border)",
              color: "var(--fg)",
            }}
          />
        </div>

        {/* View + Filters */}
        <div className="flex flex-wrap gap-2 mb-6 items-center">
          {/* View toggle */}
          <div
            className="flex rounded border overflow-hidden"
            style={{ borderColor: "var(--border)" }}
          >
            {(["flat", "stream"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="px-3 py-1 text-[11px] font-mono transition-colors"
                style={{
                  background: view === v ? "var(--fg)" : "var(--bg-elevated)",
                  color: view === v ? "var(--bg)" : "var(--fg-muted)",
                }}
              >
                {t(`audit.view.${v}`)}
              </button>
            ))}
          </div>

          <span className="mx-2 h-4 w-px" style={{ background: "var(--border)" }} />

          <button
            onClick={() => setFilter({})}
            className="px-3 py-1 rounded text-[11px] font-mono"
            style={{
              background: !filter.actor ? "var(--fg)" : "var(--bg-hover)",
              color: !filter.actor ? "var(--bg)" : "var(--fg-muted)",
            }}
          >
            {t("audit.filter.all")}
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

          <span className="ml-auto text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
            {view === "stream" ? `${streams.length} streams · ${totalSteps} steps` : `${totalSteps} actions`}
          </span>
        </div>

        {loading && <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>{t("audit.loading")}</p>}

        {/* Body */}
        {view === "flat" && (
          <div className="space-y-1">
            {actions.map((a) => (
              <ActionRow key={a.id} a={a} expanded={expanded} toggle={toggle} t={t} onJumpToStream={(target) => { setView("stream"); setQuery(target); }} />
            ))}
          </div>
        )}

        {view === "stream" && (
          <div className="space-y-3">
            {streams.map((s) => (
              <StreamCard
                key={s.target}
                stream={s}
                expanded={expanded}
                toggle={toggle}
                t={t}
              />
            ))}
          </div>
        )}

        {!loading && totalSteps === 0 && (
          <p className="text-[13px]" style={{ color: "var(--fg-dim)" }}>
            {t("audit.empty")}
          </p>
        )}
      </main>
    </>
  );
}

function ActionRow({
  a,
  expanded,
  toggle,
  t,
  onJumpToStream,
}: {
  a: Action;
  expanded: Set<string>;
  toggle: (id: string) => void;
  t: (key: string) => string;
  onJumpToStream?: (target: string) => void;
}) {
  return (
    <div
      className="rounded border transition-colors"
      style={{
        borderColor: expanded.has(a.id) ? "var(--border-muted)" : "transparent",
        background: expanded.has(a.id) ? "var(--bg-elevated)" : "transparent",
      }}
    >
      {/*
        Row is a clickable div, NOT a button. The "stream →" affordance below
        is a real <button>, and HTML forbids nested buttons (causes a React
        hydration error). Keyboard equivalent provided via tabIndex + Enter.
      */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => toggle(a.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle(a.id);
          }
        }}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[color:var(--bg-hover)] rounded transition-colors cursor-pointer"
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
            onClick={(e) => e.stopPropagation()}
          >
            {a.entity}
          </Link>
        )}
        {a.target && onJumpToStream && (
          <button
            onClick={(e) => { e.stopPropagation(); onJumpToStream(a.target!); }}
            className="text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors hover:opacity-80"
            style={{ background: "var(--bg-hover)", color: "var(--fg-dim)" }}
            title="show stream for this target"
          >
            stream →
          </button>
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
      </div>

      {expanded.has(a.id) && (
        <div className="px-4 pb-3 space-y-2">
          {a.input != null && (
            <div>
              <div className="text-[10px] font-mono mb-1" style={{ color: "var(--fg-dim)" }}>{t("audit.input")}</div>
              <pre className="text-[11px] p-2 rounded overflow-x-auto" style={{ background: "var(--bg)", color: "var(--fg-muted)" }}>
                {JSON.stringify(a.input, null, 2)}
              </pre>
            </div>
          )}
          {a.output != null && (
            <div>
              <div className="text-[10px] font-mono mb-1" style={{ color: "var(--fg-dim)" }}>{t("audit.output")}</div>
              <pre className="text-[11px] p-2 rounded overflow-x-auto" style={{ background: "var(--bg)", color: "var(--fg-muted)" }}>
                {JSON.stringify(a.output, null, 2)}
              </pre>
            </div>
          )}
          <div className="flex flex-wrap gap-4 text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
            <span>ID: {a.id}</span>
            {a.cost_tokens != null && <span>Tokens: {a.cost_tokens}</span>}
            {a.cost_usd != null && <span>Cost: ${a.cost_usd.toFixed(6)}</span>}
            {a.target && <span>Target: {a.target}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function StreamCard({
  stream,
  expanded,
  toggle,
  t,
}: {
  stream: Stream;
  expanded: Set<string>;
  toggle: (id: string) => void;
  t: (key: string) => string;
}) {
  const last = stream.steps[stream.steps.length - 1];
  const open = expanded.has(stream.target);
  const elapsed = humanDuration(stream.first_at, stream.last_at);

  return (
    <div
      className="rounded-lg border"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-elevated)",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => toggle(stream.target)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle(stream.target);
          }
        }}
        className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left rounded-lg hover:bg-[color:var(--bg-hover)] transition-colors cursor-pointer"
      >
        <span style={{ color: "var(--fg-dim)" }} className="text-[10px] font-mono shrink-0">
          {open ? "▾" : "▸"}
        </span>
        <span className="text-[12px] font-mono" style={{ color: "var(--fg)" }}>
          {stream.target}
        </span>
        {stream.entity && (
          <Link
            href={`/context/${encodeURIComponent(stream.entity)}`}
            className="text-[10px] font-mono hover:underline"
            style={{ color: "var(--fg-dim)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {stream.entity}
          </Link>
        )}
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "var(--bg-hover)", color: "var(--fg-muted)" }}>
          {stream.steps.length} {t("audit.stream.steps")}
        </span>
        <span className="text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
          {elapsed} {t("audit.stream.duration")}
        </span>
        <span className="ml-auto text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
          {t("audit.stream.latest")}: {last?.action} · {new Date(stream.last_at).toISOString().slice(11, 19)}
        </span>
      </div>

      {open && (
        <ol className="border-t px-4 py-2 space-y-1" style={{ borderColor: "var(--border)" }}>
          {stream.steps.map((step, i) => (
            <li key={step.id} className="flex items-start gap-3 py-1">
              <span
                className="text-[10px] font-mono shrink-0 w-6 text-center"
                style={{ color: "var(--fg-dim)" }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className="text-[10px] font-mono shrink-0"
                style={{ color: "var(--fg-dim)" }}
              >
                {new Date(step.ts).toISOString().slice(11, 19)}
              </span>
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
                style={{
                  background: (ACTOR_COLORS[step.actor] ?? "#666") + "20",
                  color: ACTOR_COLORS[step.actor] ?? "var(--fg-dim)",
                }}
              >
                {step.actor}
              </span>
              <span className="text-[12px] font-mono" style={{ color: "var(--fg)" }}>
                {step.action}
              </span>
              {step.partner && (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{ background: "var(--brand-wash)", color: "var(--brand)" }}
                >
                  {step.partner}
                </span>
              )}
              {step.latency_ms != null && (
                <span className="ml-auto text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
                  {step.latency_ms}ms
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function humanDuration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}
