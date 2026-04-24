// path: src/components/AblationMatrix.tsx
"use client";

import { Fragment, useState } from "react";

type Row = {
  ablation: string;
  label: string;
  correct: number;
  total: number;
  accuracy: number;
  by_category: Record<string, { correct: number; total: number }>;
  tokens_total: number;
  latency_total: number;
  sample_answers: Array<{ q: string; a: string; ok: boolean; cat: string }>;
};

type BenchmarkResponse = {
  rows: Row[];
  timestamp: string;
};

export function AblationMatrix() {
  const [data, setData] = useState<BenchmarkResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const run = async () => {
    setRunning(true);
    setData(null);
    setExpandedRow(null);
    const t0 = performance.now();
    try {
      const resp = await fetch("/api/benchmark", { cache: "no-store" });
      const json = (await resp.json()) as BenchmarkResponse;
      setElapsed(Math.round(performance.now() - t0));
      setData(json);
    } finally {
      setRunning(false);
    }
  };

  const baseline = data?.rows.find((r) => r.ablation === "none");

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-6 flex-wrap">
        <div>
          <div className="text-[13px] font-mono mb-1" style={{ color: "var(--ink-muted)" }}>
            5 configurations × 15 questions = 75 evaluations
          </div>
          <div className="text-[11px] font-mono" style={{ color: "var(--ink-dim)" }}>
            Each ablation disables one feature. Measured on stage — not projected.
          </div>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="px-4 py-2.5 rounded-md text-[13px] font-medium transition-all hover:brightness-110 disabled:opacity-60"
          style={{
            background: running ? "var(--bg-raised)" : "var(--amber)",
            color: running ? "var(--amber-bright)" : "var(--bg)",
            border: running ? "1px solid var(--amber)" : "none",
            boxShadow: running ? "none" : "0 0 30px var(--amber-glow)",
          }}
        >
          {running ? "running 75 evaluations…" : data ? "Re-run study ▶" : "Run ablation study ▶"}
        </button>
      </div>

      {data && (
        <div
          className="overflow-hidden rounded-lg"
          style={{ border: "1px solid var(--line)" }}
        >
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ background: "var(--bg-raised)" }}>
                <th
                  className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)", width: "28%" }}
                >
                  configuration
                </th>
                <th
                  className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}
                >
                  overall
                </th>
                <th
                  className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}
                >
                  basic
                </th>
                <th
                  className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}
                >
                  temporal
                </th>
                <th
                  className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}
                >
                  conflict
                </th>
                <th
                  className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-wider"
                  style={{ color: "var(--ink-dim)" }}
                >
                  Δ
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const isBaseline = r.ablation === "none";
                const delta =
                  baseline && !isBaseline
                    ? Math.round((r.accuracy - baseline.accuracy) * 100)
                    : 0;
                const expanded = expandedRow === r.ablation;
                return (
                  <Fragment key={r.ablation}>
                    <tr
                      onClick={() => setExpandedRow(expanded ? null : r.ablation)}
                      className="cursor-pointer hover:brightness-110 transition-all"
                      style={{
                        borderTop: "1px solid var(--line)",
                        background: isBaseline ? "rgba(232, 178, 107, 0.04)" : "transparent",
                      }}
                    >
                      <td
                        className="px-4 py-3 font-mono"
                        style={{
                          color: isBaseline ? "var(--amber-bright)" : "var(--ink)",
                          borderRight: "1px solid var(--line)",
                        }}
                      >
                        {expanded ? "▾" : "▸"} {r.label}
                      </td>
                      <td
                        className="px-4 py-3 font-mono"
                        style={{
                          color: isBaseline ? "var(--amber-bright)" : "var(--ink)",
                          borderRight: "1px solid var(--line)",
                          fontWeight: isBaseline ? 500 : 400,
                        }}
                      >
                        {r.correct}/{r.total} · {Math.round(r.accuracy * 100)}%
                      </td>
                      <CatCell cat={r.by_category.basic} />
                      <CatCell cat={r.by_category.temporal} />
                      <CatCell cat={r.by_category.conflict} />
                      <td
                        className="px-4 py-3 font-mono"
                        style={{
                          color:
                            delta === 0
                              ? "var(--ink-dim)"
                              : delta < 0
                                ? "#d68572"
                                : "var(--amber-bright)",
                          fontWeight: 500,
                        }}
                      >
                        {isBaseline ? "—" : delta === 0 ? "0" : `${delta > 0 ? "+" : ""}${delta}pp`}
                      </td>
                    </tr>
                    {expanded && (
                      <tr style={{ background: "var(--bg-raised)" }}>
                        <td colSpan={6} className="p-5" key="expanded">
                          <div
                            className="text-[10px] font-mono uppercase tracking-wider mb-3"
                            style={{ color: "var(--ink-dim)" }}
                          >
                            question-level result · {r.sample_answers.filter((s) => s.ok).length}{" "}
                            correct, {r.sample_answers.filter((s) => !s.ok).length} wrong
                          </div>
                          <div className="space-y-1.5">
                            {r.sample_answers.map((s, i) => (
                              <div
                                key={i}
                                className="flex items-start gap-2 text-[11px] font-mono"
                              >
                                <span
                                  className="inline-block mt-1 w-2 h-2 rounded-full flex-shrink-0"
                                  style={{
                                    background: s.ok ? "#8fd280" : "#d68572",
                                    boxShadow: s.ok
                                      ? "0 0 4px rgba(143, 210, 128, 0.4)"
                                      : "0 0 4px rgba(214, 133, 114, 0.4)",
                                  }}
                                />
                                <span
                                  className="text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider mt-0.5 flex-shrink-0"
                                  style={{
                                    background: "rgba(244, 234, 213, 0.05)",
                                    color:
                                      s.cat === "temporal"
                                        ? "#e8b26b"
                                        : s.cat === "conflict"
                                          ? "#d68572"
                                          : "var(--ink-dim)",
                                    border: "1px solid var(--line)",
                                  }}
                                >
                                  {s.cat}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <div style={{ color: "var(--ink)" }}>{s.q}</div>
                                  <div style={{ color: s.ok ? "var(--ink-muted)" : "#d68572" }}>
                                    → {s.a.slice(0, 200)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && elapsed !== null && (
        <div className="mt-3 flex items-center justify-between text-[11px] font-mono" style={{ color: "var(--ink-dim)" }}>
          <span>{data.timestamp} · click any row for question-level detail</span>
          <span>total wall clock: {elapsed}ms</span>
        </div>
      )}

      {!data && !running && (
        <div
          className="rounded-lg p-10 text-center font-mono text-[13px]"
          style={{
            background: "var(--bg-raised)",
            border: "1px dashed var(--line)",
            color: "var(--ink-dim)",
          }}
        >
          Press the button. 75 queries will fire through the engine (full, with each feature
          ablated individually, and a RAG baseline). No pre-recorded answers.
        </div>
      )}
    </div>
  );
}

function CatCell({
  cat,
}: {
  cat?: { correct: number; total: number };
}) {
  if (!cat) return <td className="px-4 py-3 font-mono" style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}>—</td>;
  const pct = Math.round((cat.correct / cat.total) * 100);
  const color = pct >= 85 ? "#8fd280" : pct >= 60 ? "#e8b26b" : "#d68572";
  return (
    <td
      className="px-4 py-3 font-mono"
      style={{ color, borderRight: "1px solid var(--line)" }}
    >
      {cat.correct}/{cat.total}
    </td>
  );
}
