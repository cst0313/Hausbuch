// path: src/components/DemoConsole.tsx
"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { ActivityLog } from "./ActivityLog";
import { FileDropZone } from "./FileDropZone";

const ENTITY = "property:berliner-str-42";
const BOT_QUESTION = "What is the current rent? And what is next month's rent?";
const DRAFTER_QUESTION = "Draft a rent reminder for June in 2–3 sentences.";

type Scenario = {
  id: string;
  label: string;
  date: string;
  icon: string;
  blurb: string;
  kind: string;
  title: string;
  raw_excerpt: string;
  source_prior: number;
};

type QueryResult = {
  answer: string;
  citations: string[];
  tokens_in: number;
  tokens_out: number;
  tokens_longctx_equiv?: number;
  cache_hit: boolean;
  model: string;
  latency_ms?: number;
};

type IngestStats = {
  facts: number;
  sources: number;
  conflicts: number;
};

export function DemoConsole() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [stage, setStage] = useState(0);
  const [contextMd, setContextMd] = useState("loading baseline…");
  const [botAns, setBotAns] = useState<QueryResult | null>(null);
  const [drafterAns, setDrafterAns] = useState<QueryResult | null>(null);
  const [typedBot, setTypedBot] = useState("");
  const [typedDraft, setTypedDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [stats, setStats] = useState<IngestStats | null>(null);
  const [lastLatency, setLastLatency] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    fetch("/api/scenarios")
      .then((r) => r.json())
      .then((data) => setScenarios(data.scenarios ?? []))
      .catch((err) => console.error("[demo] /api/scenarios failed:", err));
  }, []);

  const refreshView = useCallback(async () => {
    const ctxRes = await fetch(
      `/api/context/${encodeURIComponent(ENTITY)}?detail=3`,
      { cache: "no-store" },
    );
    const md = await ctxRes.text();
    setContextMd(md);

    // Parse trailer to update stats
    const trailer = md.match(/Lumen · (\d+) facts · (\d+) sources · (\d+) conflicts/);
    if (trailer) {
      setStats({
        facts: Number(trailer[1]),
        sources: Number(trailer[2]),
        conflicts: Number(trailer[3]),
      });
    }

    const [bot, draft] = await Promise.all([
      fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity: ENTITY, question: BOT_QUESTION, detail: 3, persona: "chatbot" }),
      }).then((r) => r.json() as Promise<QueryResult>),
      fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity: ENTITY, question: DRAFTER_QUESTION, detail: 3, persona: "drafter" }),
      }).then((r) => r.json() as Promise<QueryResult>),
    ]);
    setBotAns(bot);
    setDrafterAns(draft);
  }, []);

  const rebuildToStage = useCallback(
    async (targetStage: number) => {
      if (scenarios.length === 0) return;
      setLoading(true);
      try {
        await fetch("/api/reset", { method: "POST" });
        let lat = 0;
        for (let i = 0; i < targetStage; i++) {
          if (cancelRef.current) return;
          const s = scenarios[i];
          const res = await fetch("/api/ingest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              entity: ENTITY,
              source: {
                kind: s.kind,
                title: s.title,
                raw_excerpt: s.raw_excerpt,
                source_prior: s.source_prior,
              },
            }),
          });
          const result = await res.json();
          lat += result.latency_ms ?? 0;
        }
        setLastLatency(lat);
        await refreshView();
      } finally {
        setLoading(false);
      }
    },
    [scenarios, refreshView],
  );

  useEffect(() => {
    cancelRef.current = false;
    rebuildToStage(stage);
    return () => {
      cancelRef.current = true;
    };
  }, [stage, rebuildToStage]);

  useEffect(() => {
    if (!botAns) return;
    setTypedBot("");
    const target = botAns.answer;
    let i = 0;
    const t = setInterval(() => {
      i += 3;
      if (i >= target.length) {
        setTypedBot(target);
        clearInterval(t);
      } else {
        setTypedBot(target.slice(0, i));
      }
    }, 12);
    return () => clearInterval(t);
  }, [botAns]);

  useEffect(() => {
    if (!drafterAns) return;
    setTypedDraft("");
    const target = drafterAns.answer;
    let i = 0;
    const t = setInterval(() => {
      i += 3;
      if (i >= target.length) {
        setTypedDraft(target);
        clearInterval(t);
      } else {
        setTypedDraft(target.slice(0, i));
      }
    }, 12);
    return () => clearInterval(t);
  }, [drafterAns]);

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      if (stage < scenarios.length) {
        setStage(stage + 1);
      } else {
        setPlaying(false);
      }
    }, 9500);
    return () => clearTimeout(t);
  }, [playing, stage, scenarios.length]);

  const tokensSummary = useMemo(() => {
    if (!botAns || !drafterAns) return null;
    const lumen_total = botAns.tokens_in + drafterAns.tokens_in;
    const longctx_each = botAns.tokens_longctx_equiv ?? 0;
    const longctx_total = longctx_each * 2; // both agents would pay full corpus
    const reduction = longctx_total > 0 ? Math.max(0, Math.round((1 - lumen_total / longctx_total) * 100)) : 0;
    return {
      lumen_per_query: Math.round(lumen_total / 2),
      lumen_total,
      longctx_per_query: longctx_each,
      longctx_total,
      reduction,
      out: botAns.tokens_out + drafterAns.tokens_out,
      model: botAns.model,
    };
  }, [botAns, drafterAns]);

  const onJudgeIngested = async () => {
    setLoading(true);
    try {
      await refreshView();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Single control bar: stage + play + compact stats */}
      <div
        className="rounded-lg p-4 flex items-center gap-4 flex-wrap"
        style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <StageButton
            active={stage === 0}
            label="baseline"
            onClick={() => {
              setPlaying(false);
              setStage(0);
            }}
          />
          {scenarios.map((s, i) => (
            <StageButton
              key={s.id}
              active={stage === i + 1}
              label={`+ ${s.label}`}
              onClick={() => {
                setPlaying(false);
                setStage(i + 1);
              }}
            />
          ))}
        </div>

        <button
          onClick={() => setPlaying((p) => !p)}
          disabled={scenarios.length === 0}
          className="px-3 py-2 rounded text-[12px] font-mono transition-all disabled:opacity-40"
          style={{
            background: playing ? "rgba(232, 178, 107, 0.12)" : "transparent",
            border: `1px solid ${playing ? "var(--amber)" : "var(--line-bright)"}`,
            color: playing ? "var(--amber-bright)" : "var(--ink)",
          }}
        >
          {playing ? "◼ pause" : "▶ play"}
        </button>

        <div
          className="ml-auto flex items-center gap-5 text-[11px] font-mono"
          style={{ color: "var(--ink-muted)" }}
        >
          <span>
            <span style={{ color: "var(--ink-dim)" }}>facts </span>
            <span style={{ color: "var(--ink)" }}>{stats?.facts ?? "—"}</span>
          </span>
          <span>
            <span style={{ color: "var(--ink-dim)" }}>sources </span>
            <span style={{ color: "var(--ink)" }}>{stats?.sources ?? "—"}</span>
          </span>
          <span>
            <span style={{ color: "var(--ink-dim)" }}>conflicts </span>
            <span style={{ color: stats?.conflicts ? "#d68572" : "var(--ink)" }}>
              {stats?.conflicts ?? "—"}
            </span>
          </span>
          {lastLatency !== null && (
            <span>
              <span style={{ color: "var(--ink-dim)" }}>ingest </span>
              <span style={{ color: "var(--ink)" }}>{lastLatency}ms</span>
            </span>
          )}
          {tokensSummary && (
            <span>
              <span style={{ color: "var(--ink-dim)" }}>tokens </span>
              <span style={{ color: "var(--ink)" }}>{tokensSummary.lumen_total}</span>
            </span>
          )}
        </div>
      </div>

      {/* The hero: 3-pane */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr_1fr] gap-4">
        <AgentPanel
          title="leasing chatbot"
          badge={botAns?.model ?? "—"}
          user={BOT_QUESTION}
          assistant={typedBot}
          fullAssistant={botAns?.answer ?? ""}
          loading={loading}
        />
        <ContextPanel md={contextMd} loading={loading} />
        <AgentPanel
          title="email drafter"
          badge={drafterAns?.model ?? "—"}
          user={DRAFTER_QUESTION}
          assistant={typedDraft}
          fullAssistant={drafterAns?.answer ?? ""}
          loading={loading}
          preformatted
        />
      </div>

      <div
        className="text-[11px] font-mono"
        style={{ color: "var(--ink-dim)" }}
      >
        two agents · one shared Context.md · fetched from /api/context · SQLite-backed · bitemporal
      </div>

      {/* Cost-per-query panel — the scaling story made local */}
      {tokensSummary && (
        <div
          className="rounded-lg p-4"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
        >
          <div
            className="text-[10px] font-mono tracking-widest uppercase mb-3"
            style={{ color: "var(--ink-dim)" }}
          >
            / cost per query (this demo corpus)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div
                className="font-mono text-[10px] uppercase tracking-wider mb-1"
                style={{ color: "var(--amber-bright)" }}
              >
                lumen · structured
              </div>
              <div className="font-serif text-3xl" style={{ color: "var(--amber-bright)" }}>
                {tokensSummary.lumen_per_query.toLocaleString()}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--ink-muted)" }}>
                tokens · sent to the model per query
              </div>
            </div>
            <div>
              <div
                className="font-mono text-[10px] uppercase tracking-wider mb-1"
                style={{ color: "#d68572" }}
              >
                long-context · full corpus
              </div>
              <div className="font-serif text-3xl" style={{ color: "#d68572" }}>
                {tokensSummary.longctx_per_query.toLocaleString()}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--ink-muted)" }}>
                tokens · every source, concatenated, every time
              </div>
            </div>
            <div>
              <div
                className="font-mono text-[10px] uppercase tracking-wider mb-1"
                style={{ color: "var(--ink-dim)" }}
              >
                at scale
              </div>
              <div
                className="text-[12px] leading-relaxed"
                style={{ color: "var(--ink-muted)" }}
              >
                The gap here is modest — only {stats?.sources ?? 0} sources. At a typical enterprise
                corpus (100+ sources) Lumen&apos;s cost stays roughly flat while long-context
                scales linearly with the corpus.{" "}
                <a
                  href="/research"
                  className="font-mono hover:brightness-125"
                  style={{ color: "var(--amber-bright)" }}
                >
                  see scaling curve →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Advanced disclosure — default collapsed */}
      <div>
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[11px] font-mono tracking-widest uppercase hover:text-amber-bright transition-colors"
          style={{ color: "var(--ink-dim)" }}
        >
          {showAdvanced ? "▾ hide" : "▸ show"} pipeline activity &amp; judge drop-zone
        </button>
        {showAdvanced && (
          <div className="mt-4 space-y-4">
            <FileDropZone onIngested={onJudgeIngested} />
            <ActivityLog />
          </div>
        )}
      </div>
    </div>
  );
}

function StageButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded text-[12px] font-mono transition-all"
      style={{
        background: active ? "rgba(232, 178, 107, 0.12)" : "transparent",
        border: `1px solid ${active ? "var(--amber)" : "var(--line)"}`,
        color: active ? "var(--amber-bright)" : "var(--ink-muted)",
      }}
    >
      {label}
    </button>
  );
}

function ContextPanel({ md, loading }: { md: string; loading: boolean }) {
  return (
    <div
      className="rounded-lg overflow-hidden flex flex-col"
      style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b"
        style={{ borderColor: "var(--line)" }}
      >
        <div
          className="flex-1 font-mono text-[11px]"
          style={{ color: "var(--ink-dim)" }}
        >
          Context.md · GET /api/context/…
        </div>
        <div
          className="flex items-center gap-1.5 text-[10px] font-mono"
          style={{ color: loading ? "#d68572" : "var(--amber)" }}
        >
          {loading ? "sync" : "live"}
        </div>
      </div>
      <pre
        className="font-mono text-[11px] leading-relaxed p-4 min-h-[420px] whitespace-pre-wrap overflow-auto flex-1"
        style={{ color: "var(--ink)" }}
      >
        {formatContextMd(md)}
      </pre>
    </div>
  );
}

function formatContextMd(md: string): React.ReactNode {
  if (!md || md.startsWith("loading")) return md;
  const lines = md.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("# ")) {
      return <span key={i} style={{ color: "var(--ink-dim)" }}>{line}{"\n"}</span>;
    }
    if (line.startsWith("## ")) {
      return (
        <span key={i} style={{
          color: line.includes("Conflict") ? "#f0a868" : "var(--amber-bright)",
          fontWeight: 500,
        }}>{line}{"\n"}</span>
      );
    }
    if (line.startsWith("> ") || line.startsWith("<!--")) {
      return <span key={i} style={{ color: "var(--ink-dim)" }}>{line}{"\n"}</span>;
    }
    if (line.includes("posterior:") || line.match(/^\s+→/)) {
      return <span key={i} style={{ color: "#f0a868" }}>{line}{"\n"}</span>;
    }
    if (line.includes("^[")) {
      const idx = line.indexOf("^[");
      return (
        <span key={i}>
          <span style={{ color: "var(--ink)" }}>{line.slice(0, idx)}</span>
          <span style={{ color: "var(--ink-dim)" }}>{line.slice(idx)}</span>
          {"\n"}
        </span>
      );
    }
    return <span key={i}>{line}{"\n"}</span>;
  });
}

function AgentPanel({
  title,
  badge,
  user,
  assistant,
  fullAssistant,
  loading,
  preformatted,
}: {
  title: string;
  badge: string;
  user: string;
  assistant: string;
  fullAssistant: string;
  loading: boolean;
  preformatted?: boolean;
}) {
  const typing = !loading && assistant.length < fullAssistant.length && fullAssistant.length > 0;
  return (
    <div
      className="rounded-lg flex flex-col min-h-[440px]"
      style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
    >
      <div
        className="px-4 py-2.5 flex items-center justify-between border-b"
        style={{ borderColor: "var(--line)" }}
      >
        <span className="font-mono text-[12px]" style={{ color: "var(--ink)" }}>
          {title}
        </span>
        <span className="font-mono text-[10px]" style={{ color: "var(--ink-dim)" }}>
          {badge}
        </span>
      </div>
      <div className="flex-1 p-4 space-y-3">
        <div
          className="rounded px-3 py-2 text-[12px]"
          style={{
            background: "rgba(244, 234, 213, 0.04)",
            border: "1px solid var(--line)",
            color: "var(--ink-muted)",
          }}
        >
          <div
            className="text-[9px] font-mono mb-1 uppercase tracking-wider"
            style={{ color: "var(--ink-dim)" }}
          >
            user
          </div>
          {user}
        </div>
        <div
          className="rounded px-3 py-2 text-[12px] leading-relaxed"
          style={{
            background: "rgba(232, 178, 107, 0.04)",
            border: "1px solid rgba(232, 178, 107, 0.15)",
            color: "var(--ink)",
          }}
        >
          <div
            className="text-[9px] font-mono mb-1 uppercase tracking-wider flex items-center justify-between"
            style={{ color: "var(--amber-bright)" }}
          >
            <span>assistant</span>
            {loading && <span style={{ color: "var(--ink-dim)" }}>querying…</span>}
          </div>
          {preformatted ? (
            <pre
              className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed"
              style={{ color: "var(--ink)" }}
            >
              {assistant}
              {typing && (
                <span
                  className="inline-block"
                  style={{
                    width: 6,
                    height: 11,
                    background: "var(--amber)",
                    transform: "translateY(1px)",
                    marginLeft: 1,
                  }}
                />
              )}
            </pre>
          ) : (
            <div>
              {assistant}
              {typing && (
                <span
                  className="inline-block"
                  style={{
                    width: 6,
                    height: 11,
                    background: "var(--amber)",
                    transform: "translateY(1px)",
                    marginLeft: 1,
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
