// path: src/app/graph/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

// Brand-aligned palette. Light enough to read on either theme.
const TYPE_COLOR: Record<string, string> = {
  weg: "#c5803c",         // brand
  building: "#b86b3a",
  unit: "#94a3b8",
  tenant: "#5b9b7a",
  owner: "#a07ac0",
  contractor: "#7a8aa0",
};

const EDGE_COLOR: Record<string, string> = {
  parent: "#cbd5e1",
  tenancy: "#5b9b7a",
  ownership: "#a07ac0",
};

const LAYOUT_OPTIONS = [
  { value: "force", label: "Force-directed" },
  { value: "dagre", label: "Hierarchical" },
  { value: "radial", label: "Radial" },
  { value: "concentric", label: "Concentric" },
] as const;

type LayoutKey = (typeof LAYOUT_OPTIONS)[number]["value"];

export default function GraphPage() {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [layout, setLayout] = useState<LayoutKey>("force");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<unknown | null>(null);

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, GraphNode>();
    if (data) for (const n of data.nodes) m.set(n.id, n);
    return m;
  }, [data]);

  // Mount / re-mount the graph whenever data, layout, or filter changes.
  useEffect(() => {
    if (!data || !containerRef.current) return;

    let cancelled = false;
    let graph: { destroy?: () => void } | null = null;

    (async () => {
      // Dynamic import keeps G6 (canvas/SSR-incompatible) out of the
      // server bundle. Next.js App Router will tree-shake it correctly.
      const G6 = await import("@antv/g6");
      if (cancelled || !containerRef.current) return;

      // Build G6 data: filter dims by mutating the rendered style, not by
      // dropping nodes — judges keep their visual orientation.
      const nodes = data.nodes.map((n) => {
        const dim = filterType !== null && filterType !== n.type;
        const open = n.open_incidents > 0;
        const radius = sizeFor(n.type);
        return {
          id: n.id,
          data: {
            ...n,
            dim,
            open,
          },
          style: {
            // Visual radius / fill / stroke / label
            size: radius,
            fill: open ? "rgba(220,80,60,0.18)" : TYPE_COLOR[n.type] + "33",
            stroke: open ? "#dc5040" : TYPE_COLOR[n.type],
            lineWidth: open ? 2 : 1.4,
            opacity: dim ? 0.18 : 1,
            labelText: labelFor(n),
            labelPlacement: "bottom" as const,
            labelFontSize: n.type === "weg" ? 14 : n.type === "building" ? 12 : 10,
            labelFontWeight: n.type === "weg" ? 600 : 400,
            labelFill: "#1a1a1a",
            labelOpacity: dim ? 0.18 : 1,
            cursor: "pointer" as const,
          },
        };
      });

      const edges = data.edges.map((e, i) => {
        const fromDim = filterType !== null && (byId.get(e.from)?.type ?? "") !== filterType;
        const toDim = filterType !== null && (byId.get(e.to)?.type ?? "") !== filterType;
        const dim = fromDim && toDim;
        return {
          id: `e${i}-${e.from}-${e.to}`,
          source: e.from,
          target: e.to,
          data: { kind: e.kind },
          style: {
            stroke: EDGE_COLOR[e.kind],
            lineWidth: e.kind === "parent" ? 1.2 : 0.8,
            opacity: dim ? 0.04 : e.kind === "parent" ? 0.55 : 0.45,
            endArrow: e.kind === "parent",
            endArrowSize: 4,
          },
        };
      });

      // Layout config per chosen mode. G6 v5 picks reasonable defaults but
      // these tunings keep the dataset (~133 nodes) readable.
      const layoutConfig =
        layout === "force"
          ? {
              type: "force",
              preventOverlap: true,
              nodeSize: 32,
              linkDistance: (edge: { data?: { kind: string } }) =>
                edge.data?.kind === "parent" ? 80 : 110,
              nodeStrength: -120,
              edgeStrength: 0.55,
              animation: true,
            }
          : layout === "dagre"
            ? {
                type: "dagre",
                rankdir: "LR",
                nodesep: 14,
                ranksep: 60,
              }
            : layout === "radial"
              ? {
                  type: "radial",
                  unitRadius: 110,
                  preventOverlap: true,
                  nodeSize: 30,
                  focusNode: data.nodes.find((n) => n.type === "weg")?.id,
                }
              : {
                  type: "concentric",
                  preventOverlap: true,
                  nodeSize: 30,
                  // Concentric ordering: WEG center, buildings inner ring,
                  // units mid, people outer.
                  sortBy: (n: { data: { type: string } }) =>
                    ({ weg: 5, building: 4, unit: 3, contractor: 2, tenant: 1, owner: 1 }[n.data.type] ?? 0),
                };

      const Graph = (G6 as unknown as { Graph: new (cfg: object) => { destroy?: () => void; render: () => Promise<void>; on: (e: string, cb: (ev: { target: { id: string } }) => void) => void; fitView: () => void } }).Graph;

      const inst = new Graph({
        container: containerRef.current,
        autoResize: true,
        background: "transparent",
        data: { nodes, edges },
        layout: layoutConfig,
        node: {
          type: "circle",
        },
        edge: {
          type: "line",
        },
        behaviors: [
          "drag-canvas",
          "zoom-canvas",
          "drag-element",
          {
            type: "hover-activate",
            degree: 1,
          },
        ],
        animation: { duration: 380 },
      });

      inst.on("node:click", (ev: { target: { id: string } }) => {
        window.location.href = `/context/${encodeURIComponent(ev.target.id)}`;
      });
      inst.on("node:pointerenter", (ev: { target: { id: string } }) => {
        const n = byId.get(ev.target.id);
        if (n) setHovered(n);
      });
      inst.on("node:pointerleave", () => setHovered(null));

      await inst.render();
      inst.fitView();

      graph = inst;
      graphRef.current = inst;
    })();

    return () => {
      cancelled = true;
      if (graph?.destroy) graph.destroy();
      graphRef.current = null;
    };
  }, [data, filterType, layout, byId]);

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
            / knowledge graph · live
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
              one diagram.
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
            Drag nodes, wheel to zoom, click to open Context.md. Edges are real
            relationships in the fact store —{" "}
            <code className="mono">parent_id</code> (grey),{" "}
            <code className="mono">tenancy.unit</code>{" "}
            <span style={{ color: TYPE_COLOR.tenant }}>green</span>,{" "}
            <code className="mono">ownership.unit</code>{" "}
            <span style={{ color: TYPE_COLOR.owner }}>purple</span>.
          </p>
        </header>

        <Toolbar
          stats={data?.stats}
          activeType={filterType}
          onToggleType={setFilterType}
          layout={layout}
          onLayout={setLayout}
        />
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
          overflow: "hidden",
        }}
      >
        <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
        {!data && (
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
        )}
        {hovered && <HoverCard node={hovered} />}
      </div>
    </>
  );
}

// ── Toolbar: layout switch + type-filter chips ────────────────────────────

function Toolbar({
  stats,
  activeType,
  onToggleType,
  layout,
  onLayout,
}: {
  stats?: GraphPayload["stats"];
  activeType: string | null;
  onToggleType: (t: string | null) => void;
  layout: LayoutKey;
  onLayout: (l: LayoutKey) => void;
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
        alignItems: "center",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          gap: 0,
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {LAYOUT_OPTIONS.map((opt) => {
          const active = layout === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onLayout(opt.value)}
              style={{
                padding: "6px 12px",
                background: active ? "var(--brand)" : "var(--bg)",
                color: active ? "white" : "var(--fg)",
                border: "none",
                borderRight: "1px solid var(--border)",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {chips.map((c) => {
        const isActive = activeType === c.type;
        return (
          <button
            key={c.type}
            onClick={() => onToggleType(isActive ? null : c.type)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 12px",
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
            marginLeft: "auto",
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
        pointerEvents: "auto",
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

// ── Helpers ───────────────────────────────────────────────────────────────

function sizeFor(type: string): number {
  switch (type) {
    case "weg":
      return 44;
    case "building":
      return 32;
    case "unit":
      return 18;
    case "contractor":
      return 22;
    case "tenant":
    case "owner":
    default:
      return 16;
  }
}

function labelFor(n: GraphNode): string {
  if (n.type === "weg") return "WEG";
  if (n.type === "building") return n.name;
  if (n.type === "unit") return n.name;
  // Strip German salutations from people / contractor labels for compactness.
  return n.name.replace(/^(?:Frau|Herr|Herrn)\s+/, "").slice(0, 24);
}
