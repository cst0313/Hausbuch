// path: src/lib/reputation.ts
/**
 * Reputation engine for contractors and tenants.
 *
 * Reputation is *derived* from facts already in the store — never written as
 * its own predicate. That keeps it consistent with the rest of Hausbuch's
 * model: the document is the truth; reputation is a view onto it.
 *
 * Negative signals: open incidents, dunning notices (mahnung), cancellations,
 * unresolved status backlogs. Positive signals: contract tenure, resolved
 * incident ratio.
 *
 * Score is in [0, 1]. Below 0.4 → "avoid"; 0.4–0.7 → "ok"; above 0.7 → "trusted".
 */

import { db } from "./db";

export type ReputationFlag = {
  kind:
    | "incident_open"
    | "incident_resolved"
    | "mahnung"
    | "kuendigung"
    | "verkaufsabsicht"
    | "long_tenure";
  weight: number;
  source_id: string | null;
  at: string;
  note?: string;
};

export type Reputation = {
  entity_id: string;
  /** 0..1 score (0=avoid, 0.5=neutral, 1=trusted). */
  score: number;
  band: "avoid" | "neutral" | "trusted";
  incidents_total: number;
  incidents_open: number;
  mahnung_count: number;
  flags: ReputationFlag[];
  /** ISO timestamp of last negative signal. */
  last_incident_at: string | null;
  /** Computed at serve-time so the audit log can replay it. */
  computed_at: string;
};

type RawFact = {
  id: string;
  entity: string;
  predicate: string;
  value: string | null;
  known_from: string;
  known_to: string | null;
  source: string;
  superseded_by: string | null;
};

const NEGATIVE_PREDICATES = new Set([
  "financial.mahnung",
  "legal.kuendigung",
  "legal.verkaufsabsicht",
]);

// Per-occurrence weights are aggregated then log-damped so a contractor with
// 80 incidents isn't ~10x worse than one with 20 — diminishing returns. This
// preserves meaningful spread on a corpus where every contractor has issues.
const NEGATIVE_WEIGHTS: Record<string, number> = {
  "financial.mahnung": 0.05,
  "legal.kuendigung": 0.10,
  "legal.verkaufsabsicht": 0.03,
};

function dampedPenalty(count: number, perItem: number, cap: number): number {
  if (count <= 0) return 0;
  return Math.min(cap, perItem * Math.log10(count + 1));
}

/**
 * Compute reputation for an entity. Works for any entity but tuned for
 * contractor:*, tenant:*, and owner:*.
 */
export function getReputation(entityId: string): Reputation {
  const facts = db()
    .prepare(
      `SELECT id, entity, predicate, value, known_from, known_to, source, superseded_by
       FROM facts
       WHERE entity = @entity AND known_to IS NULL`,
    )
    .all({ entity: entityId }) as RawFact[];

  const flags: ReputationFlag[] = [];
  const incidentByStatus = new Map<string, number>();
  let lastIncidentAt: string | null = null;

  // Group incident facts by source so an incident.type + incident.status pair
  // counts as one event, not two. Each unique source contributes one incident.
  const incidentSources = new Set<string>();

  // Count negative occurrences and collect example sources for each kind.
  let kuendigungCount = 0;
  let verkaufsabsichtCount = 0;
  let mahnungCount = 0;
  let longTenureContracts = 0;
  const exampleSources: Record<string, string> = {};

  // Time-decay: a complaint from three years ago shouldn't sink someone's
  // reputation today. Recent (≤90d) incidents carry full weight; older ones
  // decay with a 180-day half-life so historical noise dilutes naturally.
  const now = Date.now();
  const RECENT_DAYS = 90;
  const HALF_LIFE_DAYS = 180;
  const recentIncidentSources = new Set<string>();
  const decayWeight = (knownFromIso: string): number => {
    const ageDays = (now - new Date(knownFromIso).getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays <= RECENT_DAYS) return 1;
    return Math.pow(0.5, (ageDays - RECENT_DAYS) / HALF_LIFE_DAYS);
  };

  let mahnungWeighted = 0;
  let kuendigungWeighted = 0;
  let verkaufsabsichtWeighted = 0;

  for (const f of facts) {
    const w = decayWeight(f.known_from);
    if (f.predicate === "incident.type") {
      incidentSources.add(f.source);
      if (w > 0.5) recentIncidentSources.add(f.source);
      if (!lastIncidentAt || f.known_from > lastIncidentAt) lastIncidentAt = f.known_from;
    }
    if (f.predicate === "incident.status" && f.value) {
      incidentByStatus.set(f.value, (incidentByStatus.get(f.value) ?? 0) + 1);
    }
    if (NEGATIVE_PREDICATES.has(f.predicate)) {
      exampleSources[f.predicate] ??= f.source;
      if (f.predicate === "financial.mahnung") {
        mahnungCount++;
        mahnungWeighted += w;
      }
      if (f.predicate === "legal.kuendigung") {
        kuendigungCount++;
        kuendigungWeighted += w;
      }
      if (f.predicate === "legal.verkaufsabsicht") {
        verkaufsabsichtCount++;
        verkaufsabsichtWeighted += w;
      }
      if (!lastIncidentAt || f.known_from > lastIncidentAt) lastIncidentAt = f.known_from;
    }
    if (f.predicate.startsWith("contract.") && yearsBetween(f.known_from, new Date().toISOString()) > 1) {
      longTenureContracts++;
    }
  }

  const incidentsTotal = incidentSources.size;
  const incidentsResolved = incidentByStatus.get("resolved") ?? 0;
  // "Open" for reputation purposes = recent unresolved incidents only.
  // Historical "reported" entries that were never updated to "resolved" are
  // common in real corpora — don't punish forever.
  const recentOpen = Math.max(0, recentIncidentSources.size - incidentsResolved);
  const incidentsOpen = Math.max(0, incidentsTotal - incidentsResolved);

  // Log-damped penalties — start at 0.85 (default trust) and chip away. Penalties
  // operate on time-weighted counts so old incidents dilute over the half-life.
  let score = 0.85;
  const incidentPenalty = dampedPenalty(recentOpen, 0.18, 0.3);
  const mahnungPenalty = dampedPenalty(mahnungWeighted, 0.14, 0.22);
  const kuendigungPenalty = dampedPenalty(kuendigungWeighted, 0.20, 0.25);
  const verkaufsPenalty = dampedPenalty(verkaufsabsichtWeighted, 0.05, 0.08);
  const resolvedBonus = dampedPenalty(incidentsResolved, 0.06, 0.15);
  const tenureBonus = longTenureContracts > 0 ? Math.min(0.1, 0.04 * longTenureContracts) : 0;

  score -= incidentPenalty;
  score -= mahnungPenalty;
  score -= kuendigungPenalty;
  score -= verkaufsPenalty;
  score += resolvedBonus;
  score += tenureBonus;
  score = Math.max(0, Math.min(1, score));

  // Build summary flags (one per kind, with the aggregate weight).
  if (incidentsOpen > 0) {
    flags.push({
      kind: "incident_open",
      weight: incidentPenalty,
      source_id: null,
      at: lastIncidentAt ?? new Date().toISOString(),
      note: `${incidentsOpen} open incident${incidentsOpen === 1 ? "" : "s"}`,
    });
  }
  if (incidentsResolved > 0) {
    flags.push({
      kind: "incident_resolved",
      weight: -resolvedBonus,
      source_id: null,
      at: lastIncidentAt ?? new Date().toISOString(),
      note: `${incidentsResolved} resolved`,
    });
  }
  if (mahnungCount > 0) {
    flags.push({
      kind: "mahnung",
      weight: mahnungPenalty,
      source_id: exampleSources["financial.mahnung"] ?? null,
      at: lastIncidentAt ?? new Date().toISOString(),
      note: `${mahnungCount} dunning notice${mahnungCount === 1 ? "" : "s"}`,
    });
  }
  if (kuendigungCount > 0) {
    flags.push({
      kind: "kuendigung",
      weight: kuendigungPenalty,
      source_id: exampleSources["legal.kuendigung"] ?? null,
      at: lastIncidentAt ?? new Date().toISOString(),
      note: `${kuendigungCount} cancellation${kuendigungCount === 1 ? "" : "s"}`,
    });
  }
  if (verkaufsabsichtCount > 0) {
    flags.push({
      kind: "verkaufsabsicht",
      weight: verkaufsPenalty,
      source_id: exampleSources["legal.verkaufsabsicht"] ?? null,
      at: lastIncidentAt ?? new Date().toISOString(),
      note: `${verkaufsabsichtCount} intent-to-sell signal${verkaufsabsichtCount === 1 ? "" : "s"}`,
    });
  }
  if (longTenureContracts > 0) {
    flags.push({
      kind: "long_tenure",
      weight: -tenureBonus,
      source_id: null,
      at: new Date().toISOString(),
      note: `${longTenureContracts} long-tenure contract${longTenureContracts === 1 ? "" : "s"}`,
    });
  }

  const band: Reputation["band"] =
    score < 0.4 ? "avoid" : score >= 0.7 ? "trusted" : "neutral";

  return {
    entity_id: entityId,
    score: Math.round(score * 100) / 100,
    band,
    incidents_total: incidentsTotal,
    incidents_open: incidentsOpen,
    mahnung_count: mahnungCount,
    flags: flags.sort((a, b) => (b.at > a.at ? 1 : -1)),
    last_incident_at: lastIncidentAt,
    computed_at: new Date().toISOString(),
  };
}

/**
 * Get reputation for a list of entities in one call. Used by inbox UI to
 * decorate dispatch_contractor action buttons.
 */
export function getReputations(entityIds: string[]): Record<string, Reputation> {
  const out: Record<string, Reputation> = {};
  for (const id of entityIds) out[id] = getReputation(id);
  return out;
}

// ── Cross-entity history ────────────────────────────────────────────────────

export type EntityHistoryEntry = {
  source_id: string;
  source_title: string | null;
  unit_id: string | null;
  predicate: string;
  value: string | null;
  at: string;
};

/**
 * Tenant cross-unit history: every fact in the corpus where this tenant is
 * the value of unit.tenant. Used to surface "tenant has 2 prior incidents
 * at WE 04 and WE 19" even after they move properties.
 */
export function getTenantHistory(tenantEntityId: string): EntityHistoryEntry[] {
  const tenantNum = tenantEntityId.replace(/^tenant:/, "");
  const rows = db()
    .prepare(
      `SELECT f.id, f.entity AS unit_entity, f.predicate, f.value, f.known_from, f.source,
              s.title AS source_title
       FROM facts f
       LEFT JOIN sources s ON s.id = f.source
       WHERE f.entity = @tenant
         AND f.known_to IS NULL
       UNION ALL
       SELECT f.id, f.entity AS unit_entity, f.predicate, f.value, f.known_from, f.source,
              s.title AS source_title
       FROM facts f
       LEFT JOIN sources s ON s.id = f.source
       WHERE f.predicate = 'unit.tenant'
         AND (f.value = @full OR f.value = @bare)
         AND f.known_to IS NULL
       ORDER BY known_from DESC`,
    )
    .all({ tenant: tenantEntityId, full: tenantEntityId, bare: tenantNum }) as Array<{
      id: string;
      unit_entity: string;
      predicate: string;
      value: string | null;
      known_from: string;
      source: string;
      source_title: string | null;
    }>;

  return rows.map((r) => ({
    source_id: r.source,
    source_title: r.source_title,
    unit_id: r.predicate === "unit.tenant" ? r.unit_entity : null,
    predicate: r.predicate,
    value: r.value,
    at: r.known_from,
  }));
}

function yearsBetween(a: string, b: string): number {
  const ms = Math.abs(new Date(b).getTime() - new Date(a).getTime());
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}
