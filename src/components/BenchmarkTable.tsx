// path: src/components/BenchmarkTable.tsx
"use client";

import { useState } from "react";

type Question = {
  category: "basic" | "temporal" | "conflict";
  question: string;
  golden_snippet: string;
  golden_regex?: RegExp;
  at_valid?: string;
  at_known?: string;
};

const ENTITY = "property:berliner-str-42";

const questions: Question[] = [
  { category: "basic", question: "Who is the current tenant of Apt 3?", golden_snippet: "Anna Schmidt" },
  { category: "basic", question: "How many units are in the building?", golden_snippet: "6" },
  { category: "basic", question: "Who is the owner?", golden_snippet: "Müller" },
  { category: "temporal", question: "What was the rent in February 2024?", golden_snippet: "1400", at_valid: "2024-02-15T00:00:00Z" },
  { category: "temporal", question: "What was the rent before March 2024?", golden_snippet: "1400", at_valid: "2024-02-15T00:00:00Z" },
  { category: "temporal", question: "When does the current lease expire?", golden_snippet: "2027-02-28" },
  { category: "temporal", question: "When was the last inspection?", golden_snippet: "2026-02-14" },
  { category: "temporal", question: "What is the rent for June 2026?", golden_snippet: "1650" },
  { category: "conflict", question: "What is the next rent and is it contested?", golden_regex: /1650|1800|conflict|contested|posterior/i, golden_snippet: "contested" },
  { category: "conflict", question: "Who says the rent should be €1,800?", golden_snippet: "landlord" },
  { category: "conflict", question: "Which source caps the rent at €1,650?", golden_snippet: "legal-memo" },
  { category: "conflict", question: "What is the posterior on the rent dispute?", golden_regex: /posterior|0\.7|0\.9|Dawid/i, golden_snippet: "posterior" },
  { category: "basic", question: "Are there any open tickets?", golden_snippet: "1" },
  { category: "basic", question: "What's the current rent?", golden_snippet: "1500" },
  { category: "temporal", question: "When did Anna's tenancy begin?", golden_snippet: "2024-03-01" },
];

type Col = "rag" | "longctx" | "hausbuch";

type Cell = { answer: string; correct: boolean; tokens_in?: number; latency_ms?: number } | null;

const normalize = (s: string) => s.toLowerCase().replace(/(\d)[,.](\d{3})/g, "$1$2");

function check(q: Question, ans: string): boolean {
  // Normalize first — strip German thousand separators — so "€1,650" matches "1650"
  const normalized = normalize(ans);
  if (q.golden_regex) return q.golden_regex.test(normalized);
  return normalized.includes(normalize(q.golden_snippet));
}

export function BenchmarkTable() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, Cell>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [done, setDone] = useState(false);

  const call = async (q: Question, col: Col): Promise<Cell> => {
    const body: Record<string, unknown> = {
      entity: ENTITY,
      question: q.question,
      detail: 3,
    };
    if (q.at_valid) body.at_valid = q.at_valid;
    if (q.at_known) body.at_known = q.at_known;
    if (col === "rag") body.baseline = "rag";
    if (col === "longctx") body.baseline = "longctx";
    // hausbuch: no baseline — full engine

    try {
      const resp = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      const answer = data.answer ?? "(empty)";
      return {
        answer,
        correct: check(q, answer),
        tokens_in: data.tokens_in ?? 0,
        latency_ms: data.latency_ms ?? 0,
      };
    } catch (err) {
      return { answer: `error: ${err}`, correct: false };
    }
  };

  const runBenchmark = async () => {
    setRunning(true);
    setResults({});
    setRevealed(new Set());
    setDone(false);

    // 1. Reset + ingest the full scenario so all columns run against the same corpus
    try {
      await fetch("/api/reset", { method: "POST" });
      const manifest = await fetch("/api/scenarios").then((r) => r.json());
      for (const s of manifest.scenarios) {
        await fetch("/api/ingest", {
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
      }
    } catch (err) {
      console.error("[benchmark] setup failed:", err);
    }

    // 2. Fire each question × each column — 45 live calls total
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const [rag, longctx, hausbuch] = await Promise.all([
        call(q, "rag"),
        call(q, "longctx"),
        call(q, "hausbuch"),
      ]);
      setResults((prev) => ({
        ...prev,
        [`${i}:rag`]: rag,
        [`${i}:longctx`]: longctx,
        [`${i}:hausbuch`]: hausbuch,
      }));
      setRevealed((prev) => {
        const next = new Set(prev);
        next.add(`${i}:rag`);
        next.add(`${i}:longctx`);
        next.add(`${i}:hausbuch`);
        return next;
      });
    }
    setRunning(false);
    setDone(true);
  };

  const score = (col: Col) => {
    const cells = questions.map((_, i) => results[`${i}:${col}`]);
    const hits = cells.filter((c) => c?.correct).length;
    const total = cells.filter((c) => c !== undefined && c !== null).length;
    return total > 0 ? `${hits}/${total}` : "—";
  };

  const pct = (col: Col) => {
    const cells = questions.map((_, i) => results[`${i}:${col}`]);
    const hits = cells.filter((c) => c?.correct).length;
    const total = cells.filter((c) => c !== undefined && c !== null).length;
    return total > 0 ? Math.round((hits / total) * 100) : 0;
  };

  const totalTokens = (col: Col) => {
    return questions.reduce((acc, _, i) => acc + (results[`${i}:${col}`]?.tokens_in ?? 0), 0);
  };

  const cell = (rowIdx: number, col: Col) => {
    const key = `${rowIdx}:${col}`;
    const data = results[key];
    const isRevealed = revealed.has(key);
    if (!isRevealed || !data) {
      return (
        <td
          className="px-3 py-3 text-[11px] font-mono"
          style={{
            color: "var(--ink-dim)",
            borderRight: "1px solid var(--line)",
            background: col === "hausbuch" ? "rgba(232, 178, 107, 0.04)" : undefined,
          }}
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full glow-pulse" style={{ background: "var(--amber)" }} />
            querying…
          </span>
        </td>
      );
    }
    return (
      <td
        className="px-3 py-3 text-[11px] font-mono fact-appear align-top"
        style={{
          color: data.correct ? "var(--ink)" : "#d68572",
          background: data.correct
            ? col === "hausbuch"
              ? "rgba(143, 210, 128, 0.06)"
              : "transparent"
            : "rgba(214, 133, 114, 0.08)",
          borderRight: "1px solid var(--line)",
        }}
      >
        <span className="flex items-start gap-1.5">
          <span
            className="inline-block mt-[3px] w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: data.correct ? "#8fd280" : "#d68572",
              boxShadow: data.correct ? "0 0 6px rgba(143, 210, 128, 0.4)" : "0 0 6px rgba(214, 133, 114, 0.4)",
            }}
          />
          <span>{data.answer}</span>
        </span>
      </td>
    );
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-6 flex-wrap">
        <div>
          <div className="text-[13px] font-mono mb-1" style={{ color: "var(--ink-muted)" }}>
            15 questions × 3 approaches = 45 live queries
          </div>
          <div className="text-[11px] font-mono" style={{ color: "var(--ink-dim)" }}>
            All three columns are measured. RAG = keyword top-k retrieval. Long-ctx = full corpus
            with modeled attention failure. Hausbuch = structured facts + bitemporal + Dawid-Skene.
          </div>
        </div>
        <button
          onClick={runBenchmark}
          disabled={running}
          className="px-4 py-2.5 rounded-md text-[13px] font-medium transition-all hover:brightness-110 disabled:opacity-60"
          style={{
            background: running ? "var(--bg-raised)" : "var(--amber)",
            color: running ? "var(--amber-bright)" : "var(--bg)",
            border: running ? "1px solid var(--amber)" : "none",
            boxShadow: running ? "none" : "0 0 30px var(--amber-glow)",
          }}
        >
          {running ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full glow-pulse" style={{ background: "var(--amber-bright)" }} />
              evaluating · 45 API calls…
            </span>
          ) : done ? (
            "Re-run benchmark ▶"
          ) : (
            "Run live benchmark ▶"
          )}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--line)" }}>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ background: "var(--bg-raised)" }}>
              <th className="text-left px-3 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)", width: "34%" }}>
                question
              </th>
              <th className="text-left px-3 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-muted)", borderRight: "1px solid var(--line)" }}>
                naive rag <span style={{ color: "var(--ink-dim)" }}>· top-k retrieval</span>
              </th>
              <th className="text-left px-3 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-muted)", borderRight: "1px solid var(--line)" }}>
                long ctx <span style={{ color: "var(--ink-dim)" }}>· full corpus</span>
              </th>
              <th className="text-left px-3 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--amber-bright)", background: "rgba(232, 178, 107, 0.06)" }}>
                hausbuch <span style={{ color: "var(--amber)" }}>· structured + bitemporal</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {questions.map((q, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                <td className="px-3 py-3 align-top" style={{ borderRight: "1px solid var(--line)" }}>
                  <div className="flex items-start gap-2">
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded uppercase mt-0.5"
                      style={{
                        background: "rgba(244, 234, 213, 0.05)",
                        color: q.category === "temporal" ? "#e8b26b" : q.category === "conflict" ? "#d68572" : "var(--ink-dim)",
                        border: "1px solid var(--line)",
                      }}
                    >
                      {q.category}
                    </span>
                    <span style={{ color: "var(--ink)" }}>{q.question}</span>
                  </div>
                </td>
                {cell(i, "rag")}
                {cell(i, "longctx")}
                {cell(i, "hausbuch")}
              </tr>
            ))}
            {done && (
              <tr style={{ borderTop: "2px solid var(--line-bright)", background: "var(--bg-raised)" }}>
                <td className="px-3 py-3 font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)", borderRight: "1px solid var(--line)" }}>
                  score
                </td>
                <td className="px-3 py-3 font-mono" style={{ color: "var(--ink-muted)", borderRight: "1px solid var(--line)" }}>
                  <div>{score("rag")} <span style={{ color: "var(--ink-dim)" }}>· {pct("rag")}%</span></div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--ink-dim)" }}>
                    {totalTokens("rag").toLocaleString()} tok
                  </div>
                </td>
                <td className="px-3 py-3 font-mono" style={{ color: "var(--ink-muted)", borderRight: "1px solid var(--line)" }}>
                  <div>{score("longctx")} <span style={{ color: "var(--ink-dim)" }}>· {pct("longctx")}%</span></div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--ink-dim)" }}>
                    {totalTokens("longctx").toLocaleString()} tok
                  </div>
                </td>
                <td className="px-3 py-3 font-mono" style={{ color: "var(--amber-bright)", background: "rgba(232, 178, 107, 0.06)", fontWeight: 500 }}>
                  <div>{score("hausbuch")} <span style={{ color: "var(--amber)" }}>· {pct("hausbuch")}%</span></div>
                  <div className="text-[10px] mt-0.5" style={{ color: "var(--amber)" }}>
                    {totalTokens("hausbuch").toLocaleString()} tok
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
