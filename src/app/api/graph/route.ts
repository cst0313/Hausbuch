// path: src/app/api/graph/route.ts
import { NextResponse } from "next/server";
import { db, listEntities, getAllFactsForEntity } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type GraphNode = {
  id: string;
  type: string;
  name: string;
  parent_id?: string | null;
  /** Counts that drive node sizing / color in the UI. */
  facts: number;
  open_incidents: number;
  /** For units: which tenant currently lives here, for quick labeling. */
  tenant?: string;
  /** For tenants: which unit they currently live in. */
  unit?: string;
  /** For owners: list of unit ids they own. */
  owns?: string[];
};

export type GraphEdge = {
  from: string;
  to: string;
  kind: "parent" | "tenancy" | "ownership";
};

export type GraphPayload = {
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

/**
 * GET /api/graph
 *
 * Returns the seeded corpus shaped as a graph: nodes (entities) + edges
 * (parent / tenancy / ownership) plus per-node summaries (fact count, open
 * incident count). Designed to be rendered as a hierarchical SVG, not a
 * force-directed simulation — the clarity wins out.
 */
export async function GET() {
  db();
  const entities = listEntities({});

  // Per-entity fact / incident summaries. One pass instead of N+1 queries.
  const factCounts = new Map<string, number>();
  const openIncidents = new Map<string, number>();
  const tenantUnit = new Map<string, string>();
  const unitTenant = new Map<string, string>();
  const ownerUnits = new Map<string, string[]>();

  for (const e of entities) {
    const facts = getAllFactsForEntity(e.id).filter((f) => f.known_to === null);
    factCounts.set(e.id, facts.length);

    if (e.type === "tenant") {
      const unitFact = facts.find((f) => f.predicate === "tenancy.unit");
      if (unitFact) {
        const unitId = `unit:${unitFact.value}`;
        tenantUnit.set(e.id, unitId);
        unitTenant.set(unitId, e.id);
      }
    }
    if (e.type === "owner") {
      const ownsFacts = facts.filter((f) => f.predicate === "ownership.unit");
      ownerUnits.set(
        e.id,
        ownsFacts.map((f) => `unit:${f.value}`),
      );
    }
    // Open incidents: count incident.type facts whose paired incident.status
    // isn't "resolved". Approximate but cheap.
    if (e.type === "tenant" || e.type === "unit" || e.type === "weg") {
      const types = facts.filter((f) => f.predicate === "incident.type");
      const status = facts.find((f) => f.predicate === "incident.status");
      if (types.length > 0 && (!status || String(status.value) !== "resolved")) {
        openIncidents.set(e.id, types.length);
      }
    }
  }

  const nodes: GraphNode[] = entities.map((e) => ({
    id: e.id,
    type: e.type,
    name: e.name,
    parent_id: e.parent_id ?? null,
    facts: factCounts.get(e.id) ?? 0,
    open_incidents: openIncidents.get(e.id) ?? 0,
    tenant: e.type === "unit" ? unitTenant.get(e.id) : undefined,
    unit: e.type === "tenant" ? tenantUnit.get(e.id) : undefined,
    owns: e.type === "owner" ? ownerUnits.get(e.id) : undefined,
  }));

  const edges: GraphEdge[] = [];
  for (const e of entities) {
    if (e.parent_id) edges.push({ from: e.parent_id, to: e.id, kind: "parent" });
  }
  for (const [tenant, unit] of tenantUnit) {
    edges.push({ from: tenant, to: unit, kind: "tenancy" });
  }
  for (const [owner, units] of ownerUnits) {
    for (const unit of units) {
      edges.push({ from: owner, to: unit, kind: "ownership" });
    }
  }

  const stats = {
    weg: entities.filter((e) => e.type === "weg").length,
    buildings: entities.filter((e) => e.type === "building").length,
    units: entities.filter((e) => e.type === "unit").length,
    tenants: entities.filter((e) => e.type === "tenant").length,
    owners: entities.filter((e) => e.type === "owner").length,
    contractors: entities.filter((e) => e.type === "contractor").length,
    open_incidents: [...openIncidents.values()].reduce((a, b) => a + b, 0),
  };

  const payload: GraphPayload = { nodes, edges, stats };
  return NextResponse.json(payload);
}
