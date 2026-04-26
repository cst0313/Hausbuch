// path: src/app/graph/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Position,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
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

type GraphEdge = {
  from: string;
  to: string;
  kind: "parent" | "tenancy" | "ownership";
};

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
  weg: "#c08040",
  building: "#b86b3a",
  unit: "#9aa6c7",
  tenant: "#5fa07a",
  owner: "#a07ac0",
  contractor: "#7a8aa0",
};

// Column x-positions for the layered layout. We compute y per node to spread
// each column's contents top-to-bottom and to align tenants with their unit.
const COL_X = {
  weg: 0,
  building: 280,
  unit: 560,
  person: 880,
  contractor: 1180,
};

export default function GraphPage() {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const { nodes, edges } = useMemo(() => buildFlowGraph(data, filterType), [data, filterType]);

  const onNodeClick: NodeMouseHandler = (_e, node) => {
    const id = node.id;
    window.location.href = `/context/${encodeURIComponent(id)}`;
  };
  const onNodeMouseEnter: NodeMouseHandler = (_e, node) => {
    const original = data?.nodes.find((n) => n.id === node.id) ?? null;
    setHovered(original);
  };
  const onNodeMouseLeave: NodeMouseHandler = () => setHovered(null);

  return (
    <>
      <Nav />
      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "32px 24px 0" }}>
        <header style={{ marginBottom: 18 }}>
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
            / knowledge graph · interactive
          </p>
          <h1
            style={{
              fontSize: 38,
              fontWeight: 500,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              margin: 0,
            }}
          >
            The seeded corpus,{" "}
            <span className="serif-italic" style={{ fontWeight: 400 }}>
              live.
            </span>
          </h1>
          <p
            style={{
              margin: "10px 0 0",
              fontSize: 14,
              color: "var(--fg-muted)",
              maxWidth: 760,
              lineHeight: 1.55,
            }}
          >
            Drag nodes around, zoom with the wheel, click a node to open its
            Context.md. Edges are real relationships from the fact store —{" "}
            <code className="mono">parent_id</code> (grey),{" "}
            <code className="mono">tenancy.unit</code>{" "}
            <span style={{ color: TYPE_COLOR.tenant }}>green</span>,{" "}
            <code className="mono">ownership.unit</code>{" "}
            <span style={{ color: TYPE_COLOR.owner }}>purple</span>.
          </p>
        </header>

        <Legend stats={data?.stats} active={filterType} onToggle={setFilterType} />
      </main>

      <div
        style={{
          height: "calc(100vh - 280px)",
          minHeight: 600,
          margin: "16px 24px 24px",
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--bg-elevated)",
          position: "relative",
        }}
      >
        {!data ? (
          <p
            className="mono"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              fontSize: 12,
              color: "var(--fg-dim)",
            }}
          >
            loading graph…
          </p>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            onNodeClick={onNodeClick}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            nodesDraggable
            nodesConnectable={false}
            elementsSelectable
            proOptions={{ hideAttribution: true }}
            minZoom={0.1}
            maxZoom={2}
          >
            <Background gap={24} size={1} color="var(--border-muted)" />
            <Controls position="bottom-right" showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => (n.data as { typeColor?: string })?.typeColor ?? "#888"}
              style={{ background: "var(--bg)" }}
            />
          </ReactFlow>
        )}

        {hovered && <HoverCard node={hovered} />}
      </div>
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
              background: isActive ? TYPE_COLOR[c.type] + "33" : "var(--bg)",
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
      {stats && stats.open_incidents > 0 && (
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

function HoverCard({ node }: { node: GraphNode }) {
  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        bottom: 16,
        maxWidth: 320,
        padding: "12px 14px",
        background: "var(--bg)",
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
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{node.name}</div>
      <div className="mono" style={{ fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.5 }}>
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
          marginTop: 8,
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

// ── Build the React Flow node + edge arrays from the API payload ──────────

function buildFlowGraph(
  data: GraphPayload | null,
  filterType: string | null,
): { nodes: Node[]; edges: Edge[] } {
  if (!data) return { nodes: [], edges: [] };

  // Layer the nodes by type into 5 columns. Inside each column we space
  // entries top-to-bottom with a fixed step, except units / tenants / owners
  // which try to align with their related unit so the parent edges are flat.
  const positions = new Map<string, { x: number; y: number }>();

  const buildings = data.nodes
    .filter((n) => n.type === "building")
    .sort((a, b) => a.id.localeCompare(b.id));
  const units = data.nodes.filter((n) => n.type === "unit");
  const tenants = data.nodes.filter((n) => n.type === "tenant");
  const owners = data.nodes.filter((n) => n.type === "owner");
  const contractors = data.nodes.filter((n) => n.type === "contractor");
  const weg = data.nodes.find((n) => n.type === "weg");

  const TOP = 0;
  const UNIT_STEP = 36;
  const PERSON_STEP = 40;

  // Units grouped by building, sorted within each group.
  const unitsByBldg = new Map<string, GraphNode[]>();
  for (const u of units) {
    const k = u.parent_id ?? "orphan";
    if (!unitsByBldg.has(k)) unitsByBldg.set(k, []);
    unitsByBldg.get(k)!.push(u);
  }
  for (const list of unitsByBldg.values()) {
    list.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  }

  // Lay out building columns vertically with a generous gap so each
  // building's units fit underneath without overlapping the next one.
  let unitCursor = TOP;
  buildings.forEach((b) => {
    const list = unitsByBldg.get(b.id) ?? [];
    const stripStart = unitCursor;
    const stripCenter = stripStart + (list.length * UNIT_STEP) / 2;
    positions.set(b.id, { x: COL_X.building, y: stripCenter });
    list.forEach((u, i) => {
      positions.set(u.id, { x: COL_X.unit, y: stripStart + i * UNIT_STEP });
    });
    unitCursor = stripStart + list.length * UNIT_STEP + 80;
  });

  // Tenant aligned with their unit y, owners stacked next to their first unit.
  for (const t of tenants) {
    if (!t.unit) continue;
    const u = positions.get(t.unit);
    if (!u) continue;
    positions.set(t.id, { x: COL_X.person, y: u.y });
  }

  // Owners — at the average y of owned units; offset slightly so they don't
  // overlap their tenant counterparts.
  const ownerCursor = new Map<number, number>();
  for (const o of owners) {
    if (!o.owns || o.owns.length === 0) continue;
    const ys = o.owns
      .map((id) => positions.get(id)?.y)
      .filter((y): y is number => typeof y === "number");
    if (ys.length === 0) continue;
    const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
    // Bucket by integer y so coincident owners get vertical offsets instead of
    // stacking on top of each other.
    const bucket = Math.round(avg / 30);
    const offset = (ownerCursor.get(bucket) ?? 0) * 30;
    ownerCursor.set(bucket, (ownerCursor.get(bucket) ?? 0) + 1);
    positions.set(o.id, { x: COL_X.person + 110, y: avg + offset });
  }

  // Contractors evenly spaced along the right column.
  contractors.forEach((c, i) => {
    positions.set(c.id, { x: COL_X.contractor, y: TOP + i * PERSON_STEP });
  });

  // WEG at the average building y.
  if (weg) {
    const ys = buildings
      .map((b) => positions.get(b.id)?.y)
      .filter((y): y is number => typeof y === "number");
    const y = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 200;
    positions.set(weg.id, { x: COL_X.weg, y });
  }

  // Build the React Flow nodes. We use the default node renderer with a
  // styled label so we don't have to register custom node types — keeps the
  // page lean.
  const nodes: Node[] = data.nodes
    .filter((n) => positions.has(n.id))
    .map((n) => {
      const p = positions.get(n.id)!;
      const dim = filterType !== null && filterType !== n.type;
      const color = TYPE_COLOR[n.type] ?? "#888";
      const isOpen = n.open_incidents > 0;
      const labelStyle: React.CSSProperties = {
        padding: "6px 10px",
        borderRadius: n.type === "weg" || n.type === "building" ? 8 : 14,
        background:
          n.type === "weg"
            ? color + "22"
            : isOpen
              ? "rgba(220,80,60,0.12)"
              : "var(--bg)",
        color: "var(--fg)",
        border: `1.4px solid ${isOpen ? "var(--severity-critical)" : color}`,
        fontSize: n.type === "weg" ? 14 : n.type === "building" ? 12 : 11,
        fontWeight: n.type === "weg" ? 600 : 500,
        minWidth: n.type === "weg" ? 80 : n.type === "building" ? 90 : 70,
        textAlign: "center" as const,
        opacity: dim ? 0.18 : 1,
        whiteSpace: "nowrap" as const,
      };
      return {
        id: n.id,
        position: p,
        data: {
          label: (
            <span style={labelStyle}>
              {n.type === "weg"
                ? "WEG"
                : n.type === "building"
                  ? n.name
                  : n.type === "unit"
                    ? n.name
                    : truncate(n.name.replace(/^(?:Frau|Herr|Herrn)\s+/, ""), 20)}
            </span>
          ),
          typeColor: color,
        },
        style: {
          background: "transparent",
          border: "none",
          padding: 0,
          opacity: dim ? 0.3 : 1,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: true,
        connectable: false,
      };
    });

  // Edges. Bezier looks best for this scale; we color by relationship kind.
  const edges: Edge[] = data.edges
    .filter((e) => positions.has(e.from) && positions.has(e.to))
    .map((e, i) => {
      const dim =
        filterType !== null &&
        !data.nodes.some(
          (n) => (n.id === e.from || n.id === e.to) && n.type === filterType,
        );
      const stroke =
        e.kind === "parent"
          ? "var(--border-muted)"
          : e.kind === "tenancy"
            ? TYPE_COLOR.tenant
            : TYPE_COLOR.owner;
      return {
        id: `e${i}-${e.from}-${e.to}`,
        source: e.from,
        target: e.to,
        type: "default",
        style: {
          stroke,
          strokeWidth: e.kind === "parent" ? 1 : 0.8,
          opacity: dim ? 0.06 : e.kind === "parent" ? 0.55 : 0.5,
        },
      };
    });

  return { nodes, edges };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
