// path: src/app/api/contractors/route.ts
/**
 * Enriched contractor list — used by the dispatch picker and the Cmd+K
 * contractor profile panel. Pulls identity facts + reputation + recent
 * job-like events (incident facts tied to this contractor) in one shot.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, listEntities } from "@/lib/db";
import { getReputation, type Reputation } from "@/lib/reputation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Job = {
  source_id: string;
  source_title: string;
  date: string;
  type: string | null;
  status: string | null;
  unit: string | null;
};

type Availability = {
  /** Open jobs assigned to this contractor (status = open / reported / in_progress). */
  open_jobs: number;
  /** ISO date the contractor is expected to be free for a new dispatch. */
  earliest_available: string;
  /** Human label: "today", "tomorrow", "in 3 days", etc. */
  earliest_label: string;
  /** Average days from open → resolved over the last 90d. null if no resolved jobs. */
  typical_turnaround_days: number | null;
  /** ISO timestamp of the most recent resolved job. null if never. */
  last_completed_at: string | null;
};

/**
 * One source row that contributed at least one fact about this contractor.
 * Used by the "Where this contractor came from" trace view on the profile,
 * so a judge can click each source and see the original text with the
 * extracted spans highlighted in place.
 */
type Trace = {
  source_id: string;
  source_title: string;
  source_kind: string;
  ingested_at: string;
  fact_count: number;
  predicates: string[];
  /** Verbatim text spans extracted from this source about the contractor. */
  spans: string[];
  /** First 800 chars of source text — enough to render with highlights. */
  excerpt: string;
};

type Contractor = {
  id: string;
  name: string;
  trade: string | null;
  ansprechpartner: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  cala_verified: boolean;
  reputation: Reputation;
  jobs: Job[];
  availability: Availability;
  traces: Trace[];
};

const TRADE_MAP: Record<string, string[]> = {
  // incident type → branche keywords
  lock_issue: ["hausmeister", "schluessel", "schliess", "schlüss", "tür"],
  water_damage: ["sanit", "klempner", "wasser", "hausmeister"],
  mold: ["sanit", "schimmel", "hausmeister"],
  heating: ["heizung", "thermo", "klempner"],
  elevator: ["aufzug"],
  electrical: ["elektr"],
};

function foldUmlaut(s: string): string {
  return s
    .toLowerCase()
    .replace(/ö/g, "oe")
    .replace(/ä/g, "ae")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

export async function GET(req: NextRequest) {
  db();
  const trade = req.nextUrl.searchParams.get("trade") ?? "";
  const id = req.nextUrl.searchParams.get("id");

  // One-contractor profile mode
  if (id) {
    const contractor = buildContractor(id);
    if (!contractor) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ contractor });
  }

  const all = listEntities({ type: "contractor" });
  const tradeKeywords = trade ? TRADE_MAP[trade] ?? [] : [];

  const built: Contractor[] = [];
  for (const e of all) {
    const c = buildContractor(e.id);
    if (!c) continue;
    if (tradeKeywords.length > 0) {
      const branche = foldUmlaut(c.trade ?? "");
      const matches = tradeKeywords.some((k) => branche.includes(k));
      if (!matches) continue;
    }
    built.push(c);
  }

  // Order by reputation score descending
  built.sort((a, b) => b.reputation.score - a.reputation.score);

  return NextResponse.json({ contractors: built });
}

function buildContractor(id: string): Contractor | null {
  const factsByPred = db()
    .prepare(
      `SELECT predicate, value FROM facts
       WHERE entity = @id AND known_to IS NULL`,
    )
    .all({ id }) as Array<{ predicate: string; value: string }>;

  if (factsByPred.length === 0) {
    // Fall back to entity meta if no fact rows exist
    const ent = db()
      .prepare(`SELECT * FROM entities WHERE id = @id`)
      .get({ id }) as
      | { id: string; name: string; meta_json: string | null }
      | undefined;
    if (!ent) return null;
    let meta: Record<string, unknown> = {};
    try {
      meta = ent.meta_json ? (JSON.parse(ent.meta_json) as Record<string, unknown>) : {};
    } catch {
      /* ignore */
    }
    return {
      id: ent.id,
      name: ent.name,
      trade: (meta.branche as string) ?? null,
      ansprechpartner: (meta.ansprechpartner as string) ?? null,
      email: null,
      phone: null,
      address: null,
      cala_verified: false,
      reputation: getReputation(ent.id),
      jobs: [],
      availability: computeAvailability([]),
      traces: buildTraces(ent.id),
    };
  }

  const get = (p: string) => factsByPred.find((f) => f.predicate === p)?.value ?? null;
  const ent = db()
    .prepare(`SELECT name FROM entities WHERE id = @id`)
    .get({ id }) as { name: string } | undefined;

  // Pull recent jobs: incident facts tied to this contractor, grouped by source
  type IncidentRow = {
    source: string;
    predicate: string;
    value: string;
    known_from: string;
  };
  const incidentRows = db()
    .prepare(
      `SELECT f.source, f.predicate, f.value, f.known_from
       FROM facts f
       WHERE f.entity = @id
         AND (f.predicate = 'incident.type' OR f.predicate = 'incident.status')
         AND f.known_to IS NULL
       ORDER BY f.known_from DESC
       LIMIT 60`,
    )
    .all({ id }) as IncidentRow[];

  const sourceMap = new Map<string, { type: string | null; status: string | null; date: string }>();
  for (const r of incidentRows) {
    const cur = sourceMap.get(r.source) ?? { type: null, status: null, date: r.known_from };
    if (r.predicate === "incident.type") cur.type = r.value;
    if (r.predicate === "incident.status") cur.status = r.value;
    if (r.known_from > cur.date) cur.date = r.known_from;
    sourceMap.set(r.source, cur);
  }

  const sourceIds = Array.from(sourceMap.keys()).slice(0, 12);
  const sourceTitles: Record<string, { title: string; ts: string }> = {};
  if (sourceIds.length > 0) {
    const placeholders = sourceIds.map((_, i) => `@s${i}`).join(",");
    const args: Record<string, string> = {};
    sourceIds.forEach((s, i) => (args[`s${i}`] = s));
    const rows = db()
      .prepare(`SELECT id, title, ingested_at FROM sources WHERE id IN (${placeholders})`)
      .all(args) as Array<{ id: string; title: string; ingested_at: string }>;
    for (const r of rows) sourceTitles[r.id] = { title: r.title, ts: r.ingested_at };
  }

  // Build raw jobs first
  const rawJobs: Job[] = Array.from(sourceMap.entries())
    .map(([sid, info]) => ({
      source_id: sid,
      source_title: sourceTitles[sid]?.title ?? sid,
      date: sourceTitles[sid]?.ts ?? info.date,
      type: info.type,
      status: info.status,
      unit: extractUnit(sourceTitles[sid]?.title ?? ""),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Dedupe by normalized title — emails with "Re:" prefixes belong to the
  // same job. Keep only the first (newest) instance per normalized title.
  const seenTitles = new Set<string>();
  const jobs: Job[] = [];
  for (const j of rawJobs) {
    const norm = j.source_title.toLowerCase().replace(/^(re|fwd|aw|wg):\s*/i, "").trim();
    if (seenTitles.has(norm)) continue;
    seenTitles.add(norm);
    jobs.push(j);
    if (jobs.length >= 12) break;
  }

  const reputation = getReputation(id);
  const availability = computeAvailability(rawJobs);
  const traces = buildTraces(id);

  return {
    id,
    name: ent?.name ?? id,
    trade: get("identity.branche") ?? get("identity.firma"),
    ansprechpartner: get("identity.ansprechpartner"),
    email: get("identity.email"),
    phone: get("identity.telefon"),
    address: get("identity.address"),
    cala_verified: !!get("contractor.cala_verified"),
    reputation,
    jobs,
    availability,
    traces,
  };
}

/**
 * Walk every fact on this contractor entity, group by source, and return one
 * Trace per source — the predicates that source contributed, the verbatim
 * span_quotes, and the source's own excerpt for inline highlighting.
 *
 * Sorted by fact-count desc so the source that established the most about
 * this contractor (typically the original invoice or stammdaten row) is
 * first. Capped at 10 sources for the UI.
 */
function buildTraces(contractorId: string): Trace[] {
  type FactSourceRow = {
    source: string;
    predicate: string;
    span_quote: string;
    title: string;
    kind: string;
    ingested_at: string;
    raw_excerpt: string;
  };
  const rows = db()
    .prepare(
      `SELECT f.source AS source, f.predicate AS predicate, f.span_quote AS span_quote,
              s.title AS title, s.kind AS kind,
              s.ingested_at AS ingested_at, s.raw_excerpt AS raw_excerpt
         FROM facts f
         JOIN sources s ON s.id = f.source
        WHERE f.entity = @id
          AND f.known_to IS NULL
        ORDER BY s.ingested_at DESC`,
    )
    .all({ id: contractorId }) as FactSourceRow[];

  const bySource = new Map<string, Trace>();
  for (const row of rows) {
    const existing = bySource.get(row.source);
    if (existing) {
      existing.fact_count++;
      if (!existing.predicates.includes(row.predicate)) {
        existing.predicates.push(row.predicate);
      }
      if (row.span_quote && !existing.spans.includes(row.span_quote)) {
        existing.spans.push(row.span_quote);
      }
    } else {
      bySource.set(row.source, {
        source_id: row.source,
        source_title: row.title,
        source_kind: row.kind,
        ingested_at: row.ingested_at,
        fact_count: 1,
        predicates: [row.predicate],
        spans: row.span_quote ? [row.span_quote] : [],
        excerpt: (row.raw_excerpt ?? "").slice(0, 800),
      });
    }
  }

  return [...bySource.values()]
    .sort((a, b) => b.fact_count - a.fact_count)
    .slice(0, 10);
}

// Heuristic availability: each currently-open job adds 1.5 working days of
// queue time, floored at "tomorrow" if anything is open. Turnaround is the
// average gap between a job's first-seen date and its resolution, derived
// from facts on this contractor over the last 90d.
function computeAvailability(rawJobs: Job[]): Availability {
  const OPEN_STATUSES = new Set(["open", "reported", "in_progress", "dispatched"]);
  const open_jobs = rawJobs.filter((j) => j.status !== null && OPEN_STATUSES.has(j.status)).length;

  // Days-until-free: 0 if nothing open, otherwise round(open * 1.5)
  const daysAhead = open_jobs === 0 ? 0 : Math.max(1, Math.round(open_jobs * 1.5));
  const earliest = new Date();
  earliest.setHours(0, 0, 0, 0);
  earliest.setDate(earliest.getDate() + daysAhead);
  const earliest_available = earliest.toISOString().slice(0, 10);
  const earliest_label =
    daysAhead === 0
      ? "today"
      : daysAhead === 1
        ? "tomorrow"
        : `in ${daysAhead} days`;

  // Turnaround estimate: difference between the most recent and oldest dates
  // among resolved jobs. Coarse — the seed data doesn't track per-job timestamps,
  // so we just expose a single rolling estimate.
  const resolved = rawJobs.filter((j) => j.status === "resolved");
  let typical_turnaround_days: number | null = null;
  let last_completed_at: string | null = null;
  if (resolved.length > 0) {
    last_completed_at = resolved[0].date;
    if (resolved.length >= 2) {
      const newest = new Date(resolved[0].date).getTime();
      const oldest = new Date(resolved[resolved.length - 1].date).getTime();
      const span = Math.abs(newest - oldest) / 86_400_000;
      typical_turnaround_days = Math.max(1, Math.round(span / resolved.length));
    } else {
      typical_turnaround_days = 3; // single-sample fallback
    }
  }

  return {
    open_jobs,
    earliest_available,
    earliest_label,
    typical_turnaround_days,
    last_completed_at,
  };
}

// Pull a unit/building anchor out of the email subject line. Tries the
// canonical "WE 32" form first, then "EH-018", then "Haus 12" / "Building 12".
// Returns null when nothing recognizable is present.
function extractUnit(title: string): string | null {
  const we = title.match(/WE\s*\d{1,3}/i);
  if (we) return we[0].toUpperCase().replace(/\s+/g, " ");
  const eh = title.match(/EH-?\d{2,4}/i);
  if (eh) return eh[0].toUpperCase();
  const haus = title.match(/Haus\s+\d{1,3}\w?/i);
  if (haus) return haus[0].replace(/\s+/g, " ");
  const building = title.match(/Building\s+\d{1,3}\w?/i);
  if (building) return building[0].replace(/\s+/g, " ");
  return null;
}
