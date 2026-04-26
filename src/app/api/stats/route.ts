// path: src/app/api/stats/route.ts
/**
 * Compact metric-only endpoint for the home page hero strip.
 *
 * The dashboard's KPI bar runs the full recommendations pipeline (3-4 s cold,
 * ~80 ms warm). The home page only needs the four counts — running that whole
 * pipeline just to show "265 open" is wasted work that makes first paint feel
 * sluggish. This endpoint hits SQLite directly with COUNT() queries, no LLM,
 * no reconciler, ~5 ms.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  db();
  // facts / sources / entities are direct counts — fast on indexed tables.
  const facts = (db().prepare(`SELECT COUNT(*) AS n FROM facts WHERE known_to IS NULL`).get() as { n: number }).n;
  const sources = (db().prepare(`SELECT COUNT(*) AS n FROM sources`).get() as { n: number }).n;
  const entities = (db().prepare(`SELECT COUNT(*) AS n FROM entities`).get() as { n: number }).n;

  // Open / critical / drafts approximated from incident facts so we don't have
  // to invoke the full recommendation engine here. Same SQL the recs engine
  // uses internally; we just don't render or rank.
  const open = (db().prepare(
    `SELECT COUNT(DISTINCT entity) AS n
       FROM facts
      WHERE predicate = 'incident.status'
        AND value != 'resolved'
        AND known_to IS NULL`,
  ).get() as { n: number }).n;

  const critical = (db().prepare(
    `SELECT COUNT(DISTINCT entity) AS n
       FROM facts
      WHERE (
              (predicate = 'legal.kuendigung'    AND value = 'true') OR
              (predicate = 'mahnung.stufe'        AND CAST(value AS INTEGER) >= 2) OR
              (predicate = 'incident.type'        AND value = 'kuendigung')
            )
        AND known_to IS NULL`,
  ).get() as { n: number }).n;

  // "Drafts ready" ≈ open recs that have a recipient email on file. Fast proxy.
  const drafts = (db().prepare(
    `SELECT COUNT(DISTINCT f.entity) AS n
       FROM facts f
      WHERE f.predicate = 'incident.status'
        AND f.value != 'resolved'
        AND f.known_to IS NULL
        AND EXISTS (
              SELECT 1 FROM facts e
               WHERE e.entity = f.entity
                 AND e.predicate IN ('identity.email', 'recipient.email')
                 AND e.known_to IS NULL
            )`,
  ).get() as { n: number }).n;

  // Latest single audit row for the live ticker.
  const latest = db().prepare(
    `SELECT actor, action, entity, ts FROM actions ORDER BY ts DESC LIMIT 1`,
  ).get() as { actor: string; action: string; entity: string | null; ts: string } | undefined;

  return NextResponse.json({
    open,
    critical,
    drafts,
    facts,
    sources,
    entities,
    latestAction: latest ?? null,
  });
}
