// path: src/app/graph/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";

type GraphNode = {
  id: string;
  type: string;
  name: string;
  parent_id?: string | null;
  facts: number;
  open_incidents: number;
  tenant?: string;
  unit?: string;
  owns?: string[];
};

type GraphEdge = { from: string; to: string; kind: "parent" | "tenancy" | "ownership" };

type GraphPayload = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    weg: number;
    buildings: number;
    units: number;
    tenants: number;
    owners: number;
    contractors: number;
    open_incidents: number;
  };
};

const TYPE_COLOR: Record<string, string> = {
  weg: "var(--brand)",
  building: "var(--severity-high)",
  unit: "var(--severity-medium)",
  tenant: "var(--rep-trusted)",
  owner: "var(--rep-neutral)",
  contractor: "var(--severity-low)",
};

export default function GraphPage() {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 32px 96px" }}>
        <header style={{ marginBottom: 24 }}>
          <p
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: "0 0 12px",
            }}
          >
            / knowledge graph
          </p>
          <h1
            style={{
              fontSize: 40,
              fontWeight: 500,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              margin: 0,
            }}
          >
            The seeded corpus,{" "}
            <span className="serif-italic" style={{ fontWeight: 400 }}>
              one diagram.
            </span>
          </h1>
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 14,
              color: "var(--fg-muted)",
              maxWidth: 720,
              lineHeight: 1.55,
            }}
          >
            One WEG, three buildings, fifty-two units, twenty-six tenants, thirty-five
            owners, sixteen contractors. Nodes are entities; lines are real relationships
            in the fact store (<code className="mono">parent_id</code>,{" "}
            <code className="mono">tenancy.unit</code>,{" "}
            <code className="mono">ownership.unit</code>). Click any node to open its
            Context.md.
          </p>
        </header>

        <Legend stats={data?.stats} active={filterType} onToggle={setFilterType} />

        {!data ? (
          <p className="mono" style={{ marginTop: 40, fontSize: 12, color: "var(--fg-dim)" }}>
            loading graph…
          </p>
        ) : (
          <Diagram
            data={data}
            filterType={filterType}
            onHover={setHovered}
          />
        )}

        {hovered && <HoverCard node={hovered} />}
      </main>
    </>
  );
}

// ── Legend / type-filter chips ────────────────────────────────────────────

function Legend({
  stats,
  active,
  onToggle,
}: {
  stats?: GraphPayload["stats"];
  active: string | null;
  onToggle: (t: string | null) => void;
}) {
  const chips: Array<{ type: string; label: string; count?: number }> = [
    { type: "weg", label: "WEG", count: stats?.weg },
    { type: "building", label: "Buildings", count: stats?.buildings },
    { type: "unit", label: "Units", count: stats?.units },
    { type: "tenant", label: "Tenants", count: stats?.tenants },
    { type: "owner", label: "Owners", count: stats?.owners },
    { type: "contractor", label: "Contractors", count: stats?.contractors },
  ];
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginBottom: 18,
        alignItems: "center",
      }}
    >
      {chips.map((c) => {
        const isActive = active === c.type;
        return (
          <button
            key={c.type}
            onClick={() => onToggle(isActive ? null : c.type)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${isActive ? TYPE_COLOR[c.type] : "var(--border)"}`,
              background: isActive ? TYPE_COLOR[c.type] + "22" : "var(--bg)",
              color: "var(--fg)",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: TYPE_COLOR[c.type],
                display: "inline-block",
              }}
            />
            {c.label}
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--fg-dim)",
                fontFeatureSettings: '"tnum"',
              }}
            >
              {c.count ?? "·"}
            </span>
          </button>
        );
      })}
      {stats && (
        <span
          className="mono"
          style={{
            marginLeft: 8,
            fontSize: 11,
            color: "var(--severity-critical)",
            padding: "5px 10px",
            border: "1px solid var(--severity-critical)",
            borderRadius: 999,
          }}
        >
          {stats.open_incidents} open incidents
        </span>
      )}
    </div>
  );
}

// ── The diagram itself ────────────────────────────────────────────────────

function Diagram({
  data,
  filterType,
  onHover,
}: {
  data: GraphPayload;
  filterType: string | null;
  onHover: (n: GraphNode | null) => void;
}) {
  // Layout: hierarchical columns from left to right.
  //   col 1: WEG (center)
  //   col 2: Buildings
  //   col 3: Units (grouped per building)
  //   col 4: Tenants + Owners (per unit)
  //   col 5: Contractors (separate cluster)
  const layout = useMemo(() => buildLayout(data), [data]);

  const muted = (t: string) => filterType !== null && filterType !== t;
  const W = 1240;
  const H = layout.height;

  return (
    <div
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 16,
        overflow: "auto",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block", minHeight: 600 }}
      >
        {/* Edges first so nodes paint on top */}
        {data.edges.map((edge, i) => {
          const a = layout.positions.get(edge.from);
          const b = layout.positions.get(edge.to);
          if (!a || !b) return null;
          const dimmed =
            filterType !== null &&
            filterType !== a.type &&
            filterType !== b.type;
          const stroke =
            edge.kind === "parent"
              ? "var(--border-muted)"
              : edge.kind === "tenancy"
                ? "var(--rep-trusted)"
                : "var(--rep-neutral)";
          return (
            <path
              key={i}
              d={`M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`}
              stroke={stroke}
              strokeWidth={edge.kind === "parent" ? 1 : 0.7}
              strokeOpacity={dimmed ? 0.08 : edge.kind === "parent" ? 0.55 : 0.4}
              fill="none"
            />
          );
        })}

        {/* Column labels */}
        {layout.columns.map((col) => (
          <text
            key={col.label}
            x={col.x}
            y={20}
            textAnchor="middle"
            fontSize="10"
            fontFamily="var(--font-mono)"
            fill="var(--fg-dim)"
            letterSpacing="0.08em"
          >
            {col.label.toUpperCase()}
          </text>
        ))}

        {/* Nodes */}
        {data.nodes.map((node) => {
          const pos = layout.positions.get(node.id);
          if (!pos) return null;
          const dim = muted(node.type);
          const radius = node.type === "weg" ? 18 : node.type === "building" ? 12 : node.type === "unit" ? 7 : 5;
          const color = TYPE_COLOR[node.type] ?? "var(--fg-dim)";
          const showLabel = node.type === "weg" || node.type === "building" || node.type === "contractor" || node.type === "unit";
          return (
            <g
              key={node.id}
              opacity={dim ? 0.18 : 1}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => onHover(node)}
              onMouseLeave={() => onHover(null)}
              onClick={() => {
                window.location.href = `/context/${encodeURIComponent(node.id)}`;
              }}
            >
              <circle
                cx={pos.x}
                cy={pos.y}
                r={radius + (node.open_incidents > 0 ? 3 : 0)}
                fill={node.open_incidents > 0 ? "var(--severity-critical)" : color}
                fillOpacity={node.open_incidents > 0 ? 0.18 : 0.18}
                stroke={node.open_incidents > 0 ? "var(--severity-critical)" : color}
                strokeWidth={node.open_incidents > 0 ? 1.4 : 0.9}
              />
              {showLabel && (
                <text
                  x={pos.x}
                  y={pos.y + radius + 14}
                  textAnchor="middle"
                  fontSize={node.type === "weg" ? 13 : node.type === "building" ? 11 : 10}
                  fontFamily="var(--font-sans)"
                  fontWeight={node.type === "weg" ? 600 : 400}
                  fill="var(--fg)"
                >
                  {node.type === "weg"
                    ? "WEG"
                    : node.type === "building"
                      ? node.name.replace(/^Haus\s+/, "Haus ")
                      : node.type === "unit"
                        ? node.name
                        : truncate(node.name, 18)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function HoverCard({ node }: { node: GraphNode }) {
  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        maxWidth: 320,
        padding: "14px 16px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
        zIndex: 50,
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: TYPE_COLOR[node.type] ?? "var(--fg-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
        }}
      >
        {node.type}
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>{node.name}</div>
      <div
        className="mono"
        style={{ fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.55 }}
      >
        <div>{node.facts} facts</div>
        {node.open_incidents > 0 && (
          <div style={{ color: "var(--severity-critical)" }}>
            {node.open_incidents} open incident{node.open_incidents > 1 ? "s" : ""}
          </div>
        )}
        {node.unit && <div>unit: {node.unit.replace(/^unit:/, "")}</div>}
        {node.tenant && <div>tenant: {node.tenant.replace(/^tenant:/, "")}</div>}
        {node.owns && node.owns.length > 0 && <div>owns: {node.owns.length} units</div>}
      </div>
      <Link
        href={`/context/${encodeURIComponent(node.id)}`}
        className="mono"
        style={{
          display: "inline-block",
          marginTop: 10,
          fontSize: 11,
          color: "var(--brand)",
          textDecoration: "none",
        }}
      >
        open Context.md →
      </Link>
    </div>
  );
}

// ── Layout: hierarchical columns ──────────────────────────────────────────

type LayoutPos = { x: number; y: number; type: string };

function buildLayout(data: GraphPayload): {
  positions: Map<string, LayoutPos>;
  columns: Array<{ x: number; label: string }>;
  height: number;
} {
  const positions = new Map<string, LayoutPos>();

  // Five columns at fixed x positions across a ~1240-wide canvas.
  const cols = {
    weg: 100,
    building: 280,
    unit: 480,
    person: 770,
    contractor: 1100,
  };

  const TOP = 60;
  const BOTTOM_PAD = 60;
  const buildings = data.nodes.filter((n) => n.type === "building").sort((a, b) => a.id.localeCompare(b.id));
  const units = data.nodes.filter((n) => n.type === "unit");
  const tenants = data.nodes.filter((n) => n.type === "tenant");
  const owners = data.nodes.filter((n) => n.type === "owner");
  const contractors = data.nodes.filter((n) => n.type === "contractor");

  // WEG: vertically centered.
  const weg = data.nodes.find((n) => n.type === "weg");

  // Buildings: spread evenly.
  const bldgGap = 200;
  buildings.forEach((b, i) => {
    positions.set(b.id, {
      x: cols.building,
      y: TOP + 60 + i * bldgGap,
      type: "building",
    });
  });

  // Units: cluster per building. We pack them in a small column under each building.
  const unitsByBuilding = new Map<string, GraphNode[]>();
  for (const u of units) {
    const parent = u.parent_id ?? "orphan";
    if (!unitsByBuilding.has(parent)) unitsByBuilding.set(parent, []);
    unitsByBuilding.get(parent)!.push(u);
  }
  // Sort each building's units by einheit_nr if available.
  for (const list of unitsByBuilding.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  const UNIT_ROW_HEIGHT = 14;
  // For each building, lay units in a vertical strip starting from the building's y.
  for (const b of buildings) {
    const list = unitsByBuilding.get(b.id) ?? [];
    const bPos = positions.get(b.id)!;
    // Centre the strip on the building's y.
    const stripHeight = list.length * UNIT_ROW_HEIGHT;
    const startY = bPos.y - stripHeight / 2;
    list.forEach((u, i) => {
      positions.set(u.id, {
        x: cols.unit,
        y: startY + i * UNIT_ROW_HEIGHT,
        type: "unit",
      });
    });
  }

  // Tenants: place next to their unit.
  for (const t of tenants) {
    if (!t.unit) continue;
    const upos = positions.get(t.unit);
    if (!upos) continue;
    positions.set(t.id, { x: cols.person, y: upos.y, type: "tenant" });
  }
  // Owners: place at average y of their owned units; slight offset right of tenants.
  for (const o of owners) {
    if (!o.owns || o.owns.length === 0) {
      // Owners with no unit data: stack at the end
      continue;
    }
    const ys = o.owns
      .map((unitId) => positions.get(unitId)?.y)
      .filter((y): y is number => typeof y === "number");
    if (ys.length === 0) continue;
    const avgY = ys.reduce((a, b) => a + b, 0) / ys.length;
    positions.set(o.id, { x: cols.person + 80, y: avgY, type: "owner" });
  }

  // Contractors: vertical column on the right, evenly spaced.
  const contractorTop = TOP + 60;
  const contractorGap = Math.max(28, ((buildings.length * bldgGap) - 60) / Math.max(1, contractors.length - 1));
  contractors.forEach((c, i) => {
    positions.set(c.id, {
      x: cols.contractor,
      y: contractorTop + i * contractorGap,
      type: "contractor",
    });
  });

  // WEG: roughly aligned with the average building y.
  if (weg) {
    const avgBldgY =
      buildings.length > 0
        ? buildings.reduce((s, b) => s + (positions.get(b.id)?.y ?? 0), 0) / buildings.length
        : 200;
    positions.set(weg.id, { x: cols.weg, y: avgBldgY, type: "weg" });
  }

  // Compute total height from the lowest node we placed.
  let maxY = TOP;
  for (const p of positions.values()) maxY = Math.max(maxY, p.y);
  const height = maxY + BOTTOM_PAD;

  return {
    positions,
    columns: [
      { x: cols.weg, label: "WEG" },
      { x: cols.building, label: "Buildings" },
      { x: cols.unit, label: "Units" },
      { x: cols.person, label: "Tenants · Owners" },
      { x: cols.contractor, label: "Contractors" },
    ],
    height,
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
