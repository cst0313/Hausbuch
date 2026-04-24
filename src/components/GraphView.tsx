// path: src/components/GraphView.tsx
// path: src/components/GraphView.tsx
"use client";

import { useEffect, useState } from "react";

type Node = {
  id: string;
  kind: string;
  label: string;
  facts: number;
  sources: string[];
};
type Edge = {
  from: string;
  to: string;
  relation: string;
  source: string;
  since?: string | null;
  confidence: number;
};

export function GraphView() {
  const [graph, setGraph] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setGraph)
      .catch((e) => console.error("graph fetch failed", e));
  }, []);

  if (!graph) {
    return (
      <div className="font-mono text-[12px]" style={{ color: "var(--ink-dim)" }}>
        loading graph…
      </div>
    );
  }

  const W = 860;
  const H = 480;
  const cx = W / 2;
  const cy = H / 2;

  // Simple radial layout: property/organization nodes inner, person nodes outer
  const byKind: Record<string, Node[]> = {};
  for (const n of graph.nodes) (byKind[n.kind] ??= []).push(n);

  const positions = new Map<string, { x: number; y: number }>();
  const kindRingRadius: Record<string, number> = {
    property: 0,        // center
    organization: 150,
    person: 240,
    unknown: 300,
  };
  for (const [kind, nodes] of Object.entries(byKind)) {
    const r = kindRingRadius[kind] ?? 180;
    if (r === 0 && nodes.length === 1) {
      positions.set(nodes[0].id, { x: cx, y: cy });
      continue;
    }
    for (let i = 0; i < nodes.length; i++) {
      const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1) + (kind === "organization" ? 0 : Math.PI / 4);
      positions.set(nodes[i].id, {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      });
    }
  }

  const nodeColor = (kind: string) =>
    kind === "property" ? "var(--amber-bright)"
    : kind === "organization" ? "#a7c4e8"
    : kind === "person" ? "#8fd280"
    : "var(--ink-muted)";

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: 520 }}>
        {/* Edges */}
        {graph.edges.map((e, i) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return null;
          const active = hovered === e.from || hovered === e.to;
          return (
            <g key={i}>
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={active ? "var(--amber-bright)" : "var(--line-bright)"}
                strokeWidth={active ? 1.6 : 0.9}
                opacity={active ? 1 : 0.6}
              />
              <text
                x={(a.x + b.x) / 2}
                y={(a.y + b.y) / 2 - 4}
                textAnchor="middle"
                fontSize="9"
                fontFamily="var(--font-mono), monospace"
                fill={active ? "var(--amber-bright)" : "var(--ink-dim)"}
                style={{ pointerEvents: "none" }}
              >
                {e.relation}
              </text>
            </g>
          );
        })}
        {/* Nodes */}
        {graph.nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const c = nodeColor(n.kind);
          const isHover = hovered === n.id;
          return (
            <g key={n.id}
               transform={`translate(${p.x},${p.y})`}
               onMouseEnter={() => setHovered(n.id)}
               onMouseLeave={() => setHovered(null)}
               style={{ cursor: "pointer" }}>
              <circle
                r={isHover ? 14 : 10}
                fill="var(--bg)"
                stroke={c}
                strokeWidth={2}
                style={{
                  filter: isHover ? `drop-shadow(0 0 10px ${c})` : "none",
                  transition: "all 200ms",
                }}
              />
              <text
                y={-18}
                textAnchor="middle"
                fontSize="11"
                fontFamily="var(--font-mono), monospace"
                fill="var(--ink)"
                style={{ pointerEvents: "none" }}
              >
                {n.label.length > 22 ? n.label.slice(0, 22) + "…" : n.label}
              </text>
              <text
                y={28}
                textAnchor="middle"
                fontSize="9"
                fontFamily="var(--font-mono), monospace"
                fill="var(--ink-dim)"
                style={{ pointerEvents: "none" }}
              >
                {n.kind} · {n.facts}f
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-5 text-[11px] font-mono" style={{ color: "var(--ink-dim)" }}>
        {graph.nodes.length} nodes · {graph.edges.length} edges · derived from the fact store
        (no separate graph DB — edges vanish when source facts are superseded)
      </div>
    </div>
  );
}
