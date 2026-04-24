// path: src/components/SourceConstellation.tsx
"use client";

import { useEffect, useState } from "react";

const sources = [
  { id: "email", label: "email", angle: 0 },
  { id: "pdf", label: "pdf", angle: 60 },
  { id: "slack", label: "slack", angle: 120 },
  { id: "erp", label: "erp", angle: 180 },
  { id: "notes", label: "notes", angle: 240 },
  { id: "db", label: "db", angle: 300 },
];

export function SourceConstellation() {
  const [pulseIdx, setPulseIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setPulseIdx((i) => (i + 1) % sources.length), 1100);
    return () => clearInterval(t);
  }, []);

  const size = 220;
  const center = size / 2;
  const radius = 88;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
      <defs>
        <radialGradient id="core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--amber-bright)" stopOpacity="1" />
          <stop offset="40%" stopColor="var(--amber)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--amber)" stopOpacity="0" />
        </radialGradient>
        <filter id="soft">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {sources.map((s, i) => {
        const rad = (s.angle * Math.PI) / 180;
        const x = center + Math.cos(rad) * radius;
        const y = center + Math.sin(rad) * radius;
        const active = i === pulseIdx;
        return (
          <g key={s.id}>
            <line
              x1={x}
              y1={y}
              x2={center}
              y2={center}
              stroke="var(--line-bright)"
              strokeWidth={active ? 1.2 : 0.5}
              strokeDasharray="2 3"
              opacity={active ? 0.9 : 0.35}
              style={{ transition: "all 400ms" }}
            />
            {active && (
              <circle
                cx={x + (center - x) * 0.5}
                cy={y + (center - y) * 0.5}
                r={2.2}
                fill="var(--amber-bright)"
                opacity={0.9}
              >
                <animate
                  attributeName="cx"
                  from={x}
                  to={center}
                  dur="1s"
                  fill="freeze"
                />
                <animate
                  attributeName="cy"
                  from={y}
                  to={center}
                  dur="1s"
                  fill="freeze"
                />
              </circle>
            )}
            <circle
              cx={x}
              cy={y}
              r={active ? 5 : 3}
              fill={active ? "var(--amber-bright)" : "var(--ink-muted)"}
              style={{
                transition: "all 400ms",
                filter: active ? "drop-shadow(0 0 6px var(--amber))" : "none",
              }}
            />
            <text
              x={x}
              y={y + 18}
              textAnchor="middle"
              fontSize={9}
              fontFamily="var(--font-mono), monospace"
              fill={active ? "var(--amber-bright)" : "var(--ink-dim)"}
              style={{ transition: "fill 400ms", letterSpacing: "0.08em" }}
            >
              {s.label}
            </text>
          </g>
        );
      })}

      {/* Core */}
      <circle cx={center} cy={center} r={26} fill="url(#core)" filter="url(#soft)" opacity={0.45} />
      <circle
        cx={center}
        cy={center}
        r={14}
        fill="var(--amber-bright)"
        style={{ filter: "drop-shadow(0 0 10px var(--amber)) drop-shadow(0 0 20px var(--amber-glow))" }}
      />
      <text
        x={center}
        y={center + 3}
        textAnchor="middle"
        fontSize={8}
        fontFamily="var(--font-mono), monospace"
        fill="var(--bg)"
        fontWeight={500}
      >
        .md
      </text>
    </svg>
  );
}
