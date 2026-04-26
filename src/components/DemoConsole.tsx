// path: src/components/DemoConsole.tsx
"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { ActivityLog } from "./ActivityLog";
import { FileDropZone } from "./FileDropZone";

const ENTITY = "unit:EH-032";
const BOT_QUESTION =
  "Summarize the most recent events at this unit. Identify the latest inbound message, who sent it, and what it concerns. State the recommended next step. Be specific — name the unit and the tenant.";
const DRAFTER_QUESTION =
  "Identify the MOST RECENT inbound message in the document (look at source titles and timestamps — a lawyer letter, a follow-up complaint, etc.) and draft a 3-4 sentence response addressing THAT specific event by surname or law firm name. Reference the unit (WE NN). Do not regress to older complaints.";

// English-friendly stage titles for the demo. Falls back to scenario.label if missing.
const SCENARIO_TITLES: Record<string, string> = {
  "mold-report": "mold complaint",
  "heating-failure": "heating failure",
  "lawyer-letter": "lawyer letter",
};

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

  const refreshContextOnly = useCallback(async () => {
    const ctxRes = await fetch(
      `/api/context/${encodeURIComponent(ENTITY)}?detail=3`,
      { cache: "no-store" },
    );
    const md = await ctxRes.text();
    setContextMd(md);
    const trailer = md.match(/Hausbuch · (\d+) facts · (\d+) sources · (\d+) conflicts/);
    if (trailer) {
      setStats({
        facts: Number(trailer[1]),
        sources: Number(trailer[2]),
        conflicts: Number(trailer[3]),
      });
    }
  }, []);

  const refreshView = useCallback(async () => {
    await refreshContextOnly();
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
  }, [refreshContextOnly]);

  const rebuildToStage = useCallback(
    async (targetStage: number, runAgents: boolean) => {
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
        if (runAgents) {
          await refreshView();
        } else {
          // Just refresh the Context.md panel and stats — leave agents idle.
          await refreshContextOnly();
        }
      } finally {
        setLoading(false);
      }
    },
    [scenarios, refreshView, refreshContextOnly],
  );

  // Agents only fire after first user interaction (play button or stage click).
  // On initial mount we just show the baseline Context.md so the panels read
  // as "ready" rather than spamming queries the user didn't ask for.
  const [agentsActivated, setAgentsActivated] = useState(false);

  useEffect(() => {
    cancelRef.current = false;
    rebuildToStage(stage, agentsActivated);
    return () => {
      cancelRef.current = true;
    };
  }, [stage, agentsActivated, rebuildToStage]);

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
    const hausbuch_total = botAns.tokens_in + drafterAns.tokens_in;
    const longctx_each = botAns.tokens_longctx_equiv ?? 0;
    const longctx_total = longctx_each * 2; // both agents would pay full corpus
    const reduction = longctx_total > 0 ? Math.max(0, Math.round((1 - hausbuch_total / longctx_total) * 100)) : 0;
    return {
      hausbuch_per_query: Math.round(hausbuch_total / 2),
      hausbuch_total,
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
        style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <StageButton
            active={stage === 0}
            label="00 · baseline"
            tooltip="Seeded WEG corpus only — no inbound emails yet"
            onClick={() => {
              setPlaying(false);
              setAgentsActivated(true);
              setStage(0);
            }}
          />
          {scenarios.map((s, i) => (
            <StageButton
              key={s.id}
              active={stage === i + 1}
              label={`${String(i + 1).padStart(2, "0")} · ${SCENARIO_TITLES[s.id] ?? s.label}`}
              tooltip={s.blurb}
              onClick={() => {
                setPlaying(false);
                setAgentsActivated(true);
                setStage(i + 1);
              }}
            />
          ))}
        </div>

        <button
          onClick={() => {
            setAgentsActivated(true);
            setPlaying((p) => !p);
          }}
          disabled={scenarios.length === 0}
          className="px-3 py-2 rounded text-[12px] font-mono transition-all disabled:opacity-40"
          style={{
            background: playing ? "rgba(13, 120, 53, 0.10)" : "transparent",
            border: `1px solid ${playing ? "var(--brand)" : "var(--border)"}`,
            color: playing ? "var(--brand)" : "var(--fg)",
          }}
        >
          {playing ? "◼ pause" : "▶ play"}
        </button>

        <div
          className="ml-auto flex items-center gap-5 text-[11px] font-mono"
          style={{ color: "var(--fg-muted)" }}
        >
          <span>
            <span style={{ color: "var(--fg-dim)" }}>facts </span>
            <span style={{ color: "var(--fg)" }}>{stats?.facts ?? "—"}</span>
          </span>
          <span>
            <span style={{ color: "var(--fg-dim)" }}>sources </span>
            <span style={{ color: "var(--fg)" }}>{stats?.sources ?? "—"}</span>
          </span>
          <span>
            <span style={{ color: "var(--fg-dim)" }}>conflicts </span>
            <span style={{ color: stats?.conflicts ? "#b45309" : "var(--fg)" }}>
              {stats?.conflicts ?? "—"}
            </span>
          </span>
          {lastLatency !== null && (
            <span>
              <span style={{ color: "var(--fg-dim)" }}>ingest </span>
              <span style={{ color: "var(--fg)" }}>{lastLatency}ms</span>
            </span>
          )}
          {tokensSummary && (
            <span>
              <span style={{ color: "var(--fg-dim)" }}>tokens </span>
              <span style={{ color: "var(--fg)" }}>{tokensSummary.hausbuch_total}</span>
            </span>
          )}
        </div>
      </div>

      {/* The hero: 3-pane */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr_1fr] gap-4">
        <AgentPanel
          title="leasing chatbot"
          badge={botAns?.model ?? (agentsActivated ? "—" : "idle")}
          user={BOT_QUESTION}
          assistant={typedBot}
          fullAssistant={botAns?.answer ?? ""}
          loading={loading}
          activated={agentsActivated}
          showUser
        />
        <ContextPanel md={contextMd} loading={loading} />
        <AgentPanel
          title="email drafter · auto"
          badge={drafterAns?.model ?? (agentsActivated ? "—" : "idle")}
          user={DRAFTER_QUESTION}
          assistant={typedDraft}
          fullAssistant={drafterAns?.answer ?? ""}
          loading={loading}
          activated={agentsActivated}
          preformatted
        />
      </div>

      <div
        className="text-[11px] font-mono"
        style={{ color: "var(--fg-dim)" }}
      >
        two agents · one shared Context.md · fetched from /api/context · SQLite-backed · bitemporal
      </div>

      {/* Cost-per-query panel — the scaling story made local */}
      {tokensSummary && (
        <div
          className="rounded-lg p-4"
          style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
        >
          <div
            className="text-[10px] font-mono tracking-widest uppercase mb-3"
            style={{ color: "var(--fg-dim)" }}
          >
            / cost per query (this demo corpus)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div
                className="font-mono text-[10px] uppercase tracking-wider mb-1"
                style={{ color: "var(--brand)" }}
              >
                hausbuch · structured
              </div>
              <div className="font-serif text-3xl" style={{ color: "var(--brand)" }}>
                {tokensSummary.hausbuch_per_query.toLocaleString()}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--fg-muted)" }}>
                tokens · sent to the model per query
              </div>
            </div>
            <div>
              <div
                className="font-mono text-[10px] uppercase tracking-wider mb-1"
                style={{ color: "#b45309" }}
              >
                long-context · full corpus
              </div>
              <div className="font-serif text-3xl" style={{ color: "#b45309" }}>
                {tokensSummary.longctx_per_query.toLocaleString()}
              </div>
              <div className="text-[11px] mt-1" style={{ color: "var(--fg-muted)" }}>
                tokens · every source, concatenated, every time
              </div>
            </div>
            <div>
              <div
                className="font-mono text-[10px] uppercase tracking-wider mb-1"
                style={{ color: "var(--fg-dim)" }}
              >
                at scale
              </div>
              <div
                className="text-[12px] leading-relaxed"
                style={{ color: "var(--fg-muted)" }}
              >
                The gap here is modest — only {stats?.sources ?? 0} sources. At a typical enterprise
                corpus (100+ sources) Hausbuch&apos;s cost stays roughly flat while long-context
                scales linearly with the corpus.{" "}
                <a
                  href="/research"
                  className="font-mono hover:opacity-80"
                  style={{ color: "var(--brand)" }}
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
          className="text-[11px] font-mono tracking-widest uppercase hover:opacity-80 transition-opacity"
          style={{ color: "var(--fg-dim)" }}
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
  tooltip,
  onClick,
}: {
  active: boolean;
  label: string;
  tooltip?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className="px-3 py-1.5 rounded text-[12px] font-mono transition-all"
      style={{
        background: active ? "rgba(13, 120, 53, 0.10)" : "transparent",
        border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
        color: active ? "var(--brand)" : "var(--fg-muted)",
      }}
    >
      {label}
    </button>
  );
}

function ContextPanel({ md, loading }: { md: string; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);

  // Stats from the trailer for the collapsed-state summary line
  const stats = useMemo(() => {
    const m = md.match(/Hausbuch · (\d+) facts · (\d+) sources · (\d+) conflicts/);
    if (!m) return null;
    return { facts: m[1], sources: m[2], conflicts: m[3] };
  }, [md]);

  // Collapse: show first ~70 lines so the panel doesn't overwhelm. Expandable.
  const COLLAPSE_LINES = 70;
  const lines = md.split("\n");
  const truncated = !expanded && lines.length > COLLAPSE_LINES;
  const display = truncated ? lines.slice(0, COLLAPSE_LINES).join("\n") : md;

  return (
    <div
      className="rounded-lg overflow-hidden flex flex-col"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="flex-1 font-mono text-[11px]"
          style={{ color: "var(--fg-dim)" }}
        >
          Context.md · GET /api/context/…
          {stats && (
            <span style={{ color: "var(--fg-muted)" }}>
              {" "}· {stats.facts}f {stats.sources}s {stats.conflicts}c
            </span>
          )}
        </div>
        {lines.length > COLLAPSE_LINES && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] font-mono px-2 py-0.5 rounded transition-colors"
            style={{
              color: "var(--fg-muted)",
              border: "1px solid var(--border)",
            }}
          >
            {expanded ? "collapse" : `show all (${lines.length} lines)`}
          </button>
        )}
        <div
          className="flex items-center gap-1.5 text-[10px] font-mono"
          style={{ color: loading ? "#b45309" : "var(--brand)" }}
        >
          {loading ? "sync" : "live"}
        </div>
      </div>
      <pre
        className="font-mono text-[11px] leading-relaxed p-4 min-h-[420px] max-h-[640px] whitespace-pre-wrap overflow-auto flex-1"
        style={{ color: "var(--fg)" }}
      >
        {formatContextMd(display)}
        {truncated && (
          <span style={{ color: "var(--fg-dim)" }}>
            {"\n…\n"}
            {`(${lines.length - COLLAPSE_LINES} more lines — click "show all" to expand)`}
          </span>
        )}
      </pre>
    </div>
  );
}

function formatContextMd(md: string): React.ReactNode {
  if (!md || md.startsWith("loading")) return md;
  const lines = md.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("# ")) {
      return <span key={i} style={{ color: "var(--fg-dim)" }}>{line}{"\n"}</span>;
    }
    if (line.startsWith("## ")) {
      return (
        <span key={i} style={{
          color: line.includes("Conflict") ? "#b45309" : "var(--brand)",
          fontWeight: 500,
        }}>{line}{"\n"}</span>
      );
    }
    if (line.startsWith("> ") || line.startsWith("<!--")) {
      return <span key={i} style={{ color: "var(--fg-dim)" }}>{line}{"\n"}</span>;
    }
    if (line.includes("posterior:") || line.match(/^\s+→/)) {
      return <span key={i} style={{ color: "#b45309" }}>{line}{"\n"}</span>;
    }
    if (line.includes("^[")) {
      const idx = line.indexOf("^[");
      return (
        <span key={i}>
          <span style={{ color: "var(--fg)" }}>{line.slice(0, idx)}</span>
          <span style={{ color: "var(--fg-dim)" }}>{line.slice(idx)}</span>
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
  activated,
  showUser,
}: {
  title: string;
  badge: string;
  user: string;
  assistant: string;
  fullAssistant: string;
  loading: boolean;
  preformatted?: boolean;
  /** Has the user clicked play / a stage button? Before that, show idle state. */
  activated: boolean;
  /** Show the user-side bubble. False for the auto-drafter. */
  showUser?: boolean;
}) {
  const typing = !loading && assistant.length < fullAssistant.length && fullAssistant.length > 0;
  return (
    <div
      className="rounded-lg flex flex-col min-h-[440px]"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
    >
      <div
        className="px-4 py-2.5 flex items-center justify-between border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="font-mono text-[12px]" style={{ color: "var(--fg)" }}>
          {title}
        </span>
        <span className="font-mono text-[10px]" style={{ color: "var(--fg-dim)" }}>
          {badge}
        </span>
      </div>

      {!activated ? (
        <div
          className="flex-1 p-6 flex items-center justify-center text-center"
          style={{ color: "var(--fg-dim)" }}
        >
          <div>
            <div className="text-[12px] mb-1" style={{ color: "var(--fg-muted)" }}>
              {showUser ? "Idle." : "Idle."}
            </div>
            <div className="text-[11px] font-mono">
              Click ▶ play or pick a stage to start
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 p-4 space-y-3">
          {showUser && (
            <div
              className="rounded px-3 py-2 text-[12px]"
              style={{
                background: "var(--bg)",
                border: "1px solid var(--border)",
                color: "var(--fg-muted)",
              }}
            >
              <div
                className="text-[9px] font-mono mb-1 uppercase tracking-wider"
                style={{ color: "var(--fg-dim)" }}
              >
                user
              </div>
              {user}
            </div>
          )}
          <div
            className="rounded px-3 py-2 text-[12px] leading-relaxed"
            style={{
              background: "rgba(13, 120, 53, 0.04)",
              border: "1px solid rgba(13, 120, 53, 0.18)",
              color: "var(--fg)",
            }}
          >
            <div
              className="text-[9px] font-mono mb-1 uppercase tracking-wider flex items-center justify-between"
              style={{ color: "var(--brand)" }}
            >
              <span>{showUser ? "assistant" : "auto-draft"}</span>
              {loading && <span style={{ color: "var(--fg-dim)" }}>querying…</span>}
            </div>
            {preformatted ? (
              <pre
                className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed"
                style={{ color: "var(--fg)" }}
              >
                {assistant}
                {typing && <Caret />}
              </pre>
            ) : (
              <div>
                {assistant}
                {typing && <Caret />}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Caret() {
  return (
    <span
      className="inline-block"
      style={{
        width: 6,
        height: 11,
        background: "var(--brand)",
        transform: "translateY(1px)",
        marginLeft: 1,
      }}
    />
  );
}
