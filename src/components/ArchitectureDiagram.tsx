// path: src/components/ArchitectureDiagram.tsx
/**
 * Static SVG that illustrates the core architectural claim:
 *   without Lumen: O(A × N × Q) reconstruction
 *   with    Lumen: O(N) ingest + O(A × Q) cheap reads
 */
export function ArchitectureDiagram() {
  return (
    <div
      className="rounded-lg p-6"
      style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Side
          title="WITHOUT a context layer"
          subtitle="each agent reconstructs from scratch"
          color="#d68572"
          content={
            <svg viewBox="0 0 320 220" width="100%">
              <defs>
                <linearGradient id="bad-edge" x1="0" x2="1">
                  <stop offset="0" stopColor="#d68572" stopOpacity="0.7" />
                  <stop offset="1" stopColor="#d68572" stopOpacity="0.3" />
                </linearGradient>
              </defs>
              {/* Sources on the left */}
              {[...Array(5)].map((_, i) => (
                <g key={i}>
                  <rect
                    x={16}
                    y={16 + i * 36}
                    width={60}
                    height={24}
                    rx={3}
                    fill="var(--bg)"
                    stroke="var(--ink-dim)"
                  />
                  <text
                    x={46}
                    y={32 + i * 36}
                    textAnchor="middle"
                    fontSize="9"
                    fontFamily="var(--font-mono)"
                    fill="var(--ink-muted)"
                  >
                    {["pdf", "email", "slack", "erp", "note"][i]}
                  </text>
                </g>
              ))}
              {/* Agents on the right */}
              {[...Array(3)].map((_, i) => (
                <g key={i}>
                  <rect
                    x={238}
                    y={30 + i * 60}
                    width={70}
                    height={28}
                    rx={4}
                    fill="var(--bg)"
                    stroke="#d68572"
                  />
                  <text
                    x={273}
                    y={48 + i * 60}
                    textAnchor="middle"
                    fontSize="10"
                    fontFamily="var(--font-mono)"
                    fill="#d68572"
                  >
                    agent {i + 1}
                  </text>
                </g>
              ))}
              {/* every source → every agent */}
              {[...Array(5)].map((_, i) =>
                [...Array(3)].map((_, j) => (
                  <line
                    key={`${i}-${j}`}
                    x1={76}
                    y1={28 + i * 36}
                    x2={238}
                    y2={44 + j * 60}
                    stroke="url(#bad-edge)"
                    strokeWidth="0.8"
                    strokeDasharray="1 2"
                  />
                )),
              )}
              <text
                x={160}
                y={210}
                textAnchor="middle"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill="#d68572"
              >
                O(A · N · Q) reconstructions
              </text>
            </svg>
          }
          note="Every agent, on every query, re-pulls from every source. Facts get re-extracted. Answers diverge. Tokens scale with A × N × Q."
        />
        <Side
          title="WITH Lumen"
          subtitle="ingest once, read many"
          color="var(--amber)"
          content={
            <svg viewBox="0 0 320 220" width="100%">
              <defs>
                <linearGradient id="good-in" x1="0" x2="1">
                  <stop offset="0" stopColor="var(--amber)" stopOpacity="0.4" />
                  <stop offset="1" stopColor="var(--amber)" stopOpacity="0.9" />
                </linearGradient>
                <linearGradient id="good-out" x1="0" x2="1">
                  <stop offset="0" stopColor="var(--amber)" stopOpacity="0.9" />
                  <stop offset="1" stopColor="var(--amber)" stopOpacity="0.4" />
                </linearGradient>
              </defs>
              {/* Sources on the left */}
              {[...Array(5)].map((_, i) => (
                <g key={i}>
                  <rect
                    x={16}
                    y={16 + i * 36}
                    width={60}
                    height={24}
                    rx={3}
                    fill="var(--bg)"
                    stroke="var(--ink-dim)"
                  />
                  <text
                    x={46}
                    y={32 + i * 36}
                    textAnchor="middle"
                    fontSize="9"
                    fontFamily="var(--font-mono)"
                    fill="var(--ink-muted)"
                  >
                    {["pdf", "email", "slack", "erp", "note"][i]}
                  </text>
                </g>
              ))}
              {/* Lumen node */}
              <rect
                x={128}
                y={82}
                width={70}
                height={56}
                rx={6}
                fill="rgba(232, 178, 107, 0.08)"
                stroke="var(--amber)"
                strokeWidth={1.5}
                style={{ filter: "drop-shadow(0 0 12px var(--amber-glow))" }}
              />
              <text
                x={163}
                y={104}
                textAnchor="middle"
                fontSize="11"
                fontFamily="var(--font-serif)"
                fontStyle="italic"
                fill="var(--amber-bright)"
              >
                Lumen
              </text>
              <text
                x={163}
                y={120}
                textAnchor="middle"
                fontSize="9"
                fontFamily="var(--font-mono)"
                fill="var(--ink-muted)"
              >
                Context.md
              </text>
              {/* agents */}
              {[...Array(3)].map((_, i) => (
                <g key={i}>
                  <rect
                    x={238}
                    y={30 + i * 60}
                    width={70}
                    height={28}
                    rx={4}
                    fill="var(--bg)"
                    stroke="var(--amber)"
                  />
                  <text
                    x={273}
                    y={48 + i * 60}
                    textAnchor="middle"
                    fontSize="10"
                    fontFamily="var(--font-mono)"
                    fill="var(--amber-bright)"
                  >
                    agent {i + 1}
                  </text>
                </g>
              ))}
              {/* sources → Lumen */}
              {[...Array(5)].map((_, i) => (
                <line
                  key={i}
                  x1={76}
                  y1={28 + i * 36}
                  x2={128}
                  y2={110}
                  stroke="url(#good-in)"
                  strokeWidth="1.2"
                />
              ))}
              {/* Lumen → agents */}
              {[...Array(3)].map((_, i) => (
                <line
                  key={i}
                  x1={198}
                  y1={110}
                  x2={238}
                  y2={44 + i * 60}
                  stroke="url(#good-out)"
                  strokeWidth="1.5"
                />
              ))}
              <text
                x={160}
                y={210}
                textAnchor="middle"
                fontSize="10"
                fontFamily="var(--font-mono)"
                fill="var(--amber-bright)"
              >
                O(N) ingest + O(A · Q) cheap reads
              </text>
            </svg>
          }
          note="Ingest once — the N → 1 fan-in. Agents query the cached Context.md — the 1 → A fan-out. Cost grows additively, not multiplicatively."
        />
      </div>

      <div
        className="mt-6 pt-4 text-[13px] leading-relaxed"
        style={{ color: "var(--ink-muted)", borderTop: "1px solid var(--line)" }}
      >
        <span style={{ color: "var(--ink)" }}>The scaling claim, in one line:</span>{" "}
        without a context layer, total token cost of answering Q questions from A agents over N
        sources is <span className="font-mono" style={{ color: "#d68572" }}>A · Q · Σ|sᵢ|</span>. With
        Lumen, it&apos;s <span className="font-mono" style={{ color: "var(--amber-bright)" }}>Σ|sᵢ|</span> (ingest,
        paid once) <span className="font-mono">+ A · Q · |Context.md|</span> (where |Context.md| is
        near-constant in N because duplicate facts collapse).
      </div>
    </div>
  );
}

function Side({
  title,
  subtitle,
  color,
  content,
  note,
}: {
  title: string;
  subtitle: string;
  color: string;
  content: React.ReactNode;
  note: string;
}) {
  return (
    <div>
      <div
        className="text-[10px] font-mono uppercase tracking-wider mb-1"
        style={{ color }}
      >
        {title}
      </div>
      <div
        className="text-[12px] font-mono mb-3"
        style={{ color: "var(--ink-dim)" }}
      >
        {subtitle}
      </div>
      <div className="mb-3">{content}</div>
      <div className="text-[12px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
        {note}
      </div>
    </div>
  );
}
