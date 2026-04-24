// path: src/components/ComparisonTable.tsx
const rows = [
  {
    axis: "storage primitive",
    rag: "vector chunks",
    longctx: "concatenated text",
    lumen: "structured facts",
  },
  {
    axis: "temporal awareness",
    rag: "none",
    longctx: "none",
    lumen: "bitemporal (valid × known)",
  },
  {
    axis: "conflict handling",
    rag: "silent — top-k wins",
    longctx: "silent — LLM guesses",
    lumen: "Bayesian posterior, visible",
  },
  {
    axis: "attribution",
    rag: "chunk reference",
    longctx: "none",
    lumen: "text-span proof",
  },
  {
    axis: "tokens / query",
    rag: "~15k",
    longctx: "~40k",
    lumen: "~0.5k (measured)",
  },
  {
    axis: "prompt cache hit",
    rag: "variable",
    longctx: "variable",
    lumen: "engineered stable",
  },
  {
    axis: "human-readable",
    rag: "no",
    longctx: "no",
    lumen: "markdown, git-diffable",
  },
];

export function ComparisonTable() {
  return (
    <div className="overflow-hidden rounded-lg" style={{ border: "1px solid var(--line)" }}>
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ background: "var(--bg-raised)" }}>
            <th className="text-left px-5 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}>
              /
            </th>
            <th className="text-left px-5 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)", borderRight: "1px solid var(--line)" }}>
              naive rag
            </th>
            <th className="text-left px-5 py-4 font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-muted)", borderRight: "1px solid var(--line)" }}>
              long context
            </th>
            <th
              className="text-left px-5 py-4 font-mono text-[11px] uppercase tracking-wider"
              style={{
                color: "var(--amber-bright)",
                background: "rgba(232, 178, 107, 0.06)",
              }}
            >
              lumen
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.axis} style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
              <td className="px-5 py-4 font-mono text-[12px]" style={{ color: "var(--ink-muted)", borderRight: "1px solid var(--line)" }}>
                {r.axis}
              </td>
              <td className="px-5 py-4 text-[13px]" style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}>
                {r.rag}
              </td>
              <td className="px-5 py-4 text-[13px]" style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}>
                {r.longctx}
              </td>
              <td
                className="px-5 py-4 text-[13px]"
                style={{
                  color: "var(--ink)",
                  background: "rgba(232, 178, 107, 0.04)",
                  fontWeight: 500,
                }}
              >
                {r.lumen}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
