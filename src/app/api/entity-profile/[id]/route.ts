// path: src/app/api/entity-profile/[id]/route.ts
/**
 * Enriched profile for any entity (tenant / owner / unit / building / weg).
 * Returns identity, reputation (when applicable), related entities for
 * click-through, and recent sources.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, getEntity, getAllFactsForEntity } from "@/lib/db";
import { getReputation, getTenantHistory } from "@/lib/reputation";
import { listActions } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SourceRow = {
  id: string;
  kind: string;
  title: string;
  ingested_at: string;
  from_addr: string | null;
  to_addr: string | null;
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  db();
  const { id } = await ctx.params;
  const entityId = decodeURIComponent(id);
  const entity = getEntity(entityId);
  if (!entity) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }

  const facts = getAllFactsForEntity(entityId).filter((f) => f.known_to === null);

  // Bucket facts
  const identity: Record<string, string> = {};
  for (const f of facts) {
    if (f.predicate.startsWith("identity.")) {
      identity[f.predicate.replace("identity.", "")] = String(f.value);
    }
  }

  // Recent sources for this entity
  const recentSources = db()
    .prepare(
      `SELECT id, kind, title, ingested_at, from_addr, to_addr
       FROM sources WHERE entity_id = @id
       ORDER BY ingested_at DESC LIMIT 25`,
    )
    .all({ id: entityId }) as SourceRow[];

  // Self-improving signal: how often has the agent been asked about this
  // entity, and how has feedback trended? Sourced from the audit log.
  const queryStats = db()
    .prepare(
      `SELECT
         SUM(CASE WHEN action LIKE 'agent.%' AND ts > datetime('now', '-7 days') THEN 1 ELSE 0 END) AS week,
         SUM(CASE WHEN action LIKE 'agent.%' AND ts > datetime('now', '-30 days') THEN 1 ELSE 0 END) AS month,
         SUM(CASE WHEN action = 'agent.feedback.up'   THEN 1 ELSE 0 END) AS up,
         SUM(CASE WHEN action = 'agent.feedback.down' THEN 1 ELSE 0 END) AS down
       FROM actions
       WHERE entity = @id`,
    )
    .get({ id: entityId }) as {
      week: number | null;
      month: number | null;
      up: number | null;
      down: number | null;
    };

  // Group incident.* facts by type so the UI can show "heating × 5" with a
  // timeline of each occurrence — the user wanted to verify a stacked count
  // by drilling into the dates.
  type IncidentRow = {
    type: string;
    count: number;
    latest_status: string | null;
    occurrences: Array<{ source_id: string; source_title: string; date: string }>;
  };
  const incidentTypeFacts = db()
    .prepare(
      `SELECT f.value AS type, f.source AS source_id, s.title AS source_title,
              COALESCE(s.ingested_at, f.known_from) AS date
         FROM facts f
         JOIN sources s ON s.id = f.source
        WHERE f.entity = @id
          AND f.predicate = 'incident.type'
          AND f.known_to IS NULL
        ORDER BY date DESC`,
    )
    .all({ id: entityId }) as Array<{
      type: string;
      source_id: string;
      source_title: string;
      date: string;
    }>;
  const incidentByType = new Map<string, IncidentRow>();
  for (const row of incidentTypeFacts) {
    const cur = incidentByType.get(row.type) ?? {
      type: row.type,
      count: 0,
      latest_status: null,
      occurrences: [],
    };
    cur.count++;
    cur.occurrences.push({
      source_id: row.source_id,
      source_title: row.source_title,
      date: row.date,
    });
    incidentByType.set(row.type, cur);
  }
  // Find latest status per type from incident.status facts on the same entity.
  const statusFacts = db()
    .prepare(
      `SELECT f.value AS status, COALESCE(s.ingested_at, f.known_from) AS date,
              f.source AS source_id
         FROM facts f
         JOIN sources s ON s.id = f.source
        WHERE f.entity = @id
          AND f.predicate = 'incident.status'
          AND f.known_to IS NULL
        ORDER BY date DESC`,
    )
    .all({ id: entityId }) as Array<{ status: string; date: string; source_id: string }>;
  for (const inc of incidentByType.values()) {
    const sourceIds = new Set(inc.occurrences.map((o) => o.source_id));
    const matched = statusFacts.find((s) => sourceIds.has(s.source_id));
    inc.latest_status = matched?.status ?? null;
  }
  const incidents = [...incidentByType.values()].sort((a, b) => b.count - a.count);

  const profile: {
    id: string;
    name: string;
    type: string;
    meta: Record<string, unknown> | undefined;
    identity: Record<string, string>;
    reputation?: ReturnType<typeof getReputation>;
    tenants?: Array<{ id: string; name: string }>;
    owners?: Array<{ id: string; name: string }>;
    units?: Array<{ id: string; name: string }>;
    history?: Array<{ unit_id: string; source_id: string; source_title: string | null; at: string }>;
    sources: Array<SourceRow>;
    audit: ReturnType<typeof listActions>;
    related_units?: string[];
    query_stats: { week: number; month: number; up: number; down: number };
    incidents: IncidentRow[];
  } = {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    meta: entity.meta,
    identity,
    sources: recentSources,
    audit: listActions({ entity: entityId, limit: 30 }),
    query_stats: {
      week: queryStats.week ?? 0,
      month: queryStats.month ?? 0,
      up: queryStats.up ?? 0,
      down: queryStats.down ?? 0,
    },
    incidents,
  };

  if (["tenant", "owner", "contractor"].includes(entity.type)) {
    profile.reputation = getReputation(entityId);
  }

  if (entity.type === "tenant") {
    const history = getTenantHistory(entityId);
    profile.history = history
      .filter((h) => h.predicate === "unit.tenant" && h.unit_id)
      .map((h) => ({
        unit_id: h.unit_id!,
        source_id: h.source_id,
        source_title: h.source_title,
        at: h.at,
      }));
    // Current units (de-duped)
    const seen = new Set<string>();
    profile.related_units = [];
    for (const h of profile.history) {
      if (!seen.has(h.unit_id)) {
        seen.add(h.unit_id);
        profile.related_units.push(h.unit_id);
      }
    }
  }

  if (entity.type === "unit") {
    // Find current tenant + owner via facts
    const tenantFact = facts.find((f) => f.predicate === "unit.tenant");
    const ownerFact = facts.find((f) => f.predicate === "unit.owner");
    if (tenantFact) {
      const tenantId = `tenant:${String(tenantFact.value).replace(/^tenant:/, "")}`;
      const t = getEntity(tenantId);
      profile.tenants = t ? [{ id: t.id, name: t.name }] : [];
    }
    if (ownerFact) {
      const ownerId = `owner:${String(ownerFact.value).replace(/^owner:/, "")}`;
      const o = getEntity(ownerId);
      profile.owners = o ? [{ id: o.id, name: o.name }] : [];
    }
  }

  if (entity.type === "owner") {
    // Units this owner owns
    const unitFacts = facts.filter((f) => f.predicate === "ownership.unit");
    profile.units = [];
    for (const f of unitFacts) {
      const unitId = `unit:${String(f.value).replace(/^unit:/, "")}`;
      const u = getEntity(unitId);
      if (u) profile.units.push({ id: u.id, name: u.name });
    }
  }

  if (entity.type === "building") {
    // Units in this building — filter by type to exclude any auto-created
    // tenants/owners that may have been parented here by routing.
    const units = db()
      .prepare(
        `SELECT id, name FROM entities
         WHERE parent_id = @id AND type = 'unit'
         ORDER BY name`,
      )
      .all({ id: entityId }) as Array<{ id: string; name: string }>;
    profile.units = units;
  }

  if (entity.type === "weg") {
    // Buildings under this WEG — must filter by type='building'. Auto-created
    // tenants/owners get parent_id = WEG too, so without this filter the
    // "Buildings · 8" section would include 5 phantom rows from the sandbox
    // bootstrap flow (real seed has 3 buildings).
    const buildings = db()
      .prepare(
        `SELECT id, name FROM entities
         WHERE parent_id = @id AND type = 'building'
         ORDER BY name`,
      )
      .all({ id: entityId }) as Array<{ id: string; name: string }>;
    profile.units = buildings;
  }

  return NextResponse.json({ profile });
}
