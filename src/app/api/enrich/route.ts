// path: src/app/api/enrich/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, getAllFactsForEntity } from "@/lib/db";
import { runEnrichments } from "@/lib/enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/enrich — manually trigger Tavily enrichments for an entity.
 *
 * Body: { entity: string, fact_ids?: string[] }
 *   - If `fact_ids` is omitted, enriches every currently-known fact for the entity.
 *   - If provided, only those facts are considered.
 *
 * Useful for the demo (re-runs without re-ingesting) and for filling caches
 * cold-start. Same 6s-per-lookup timeout as the inline ingest path.
 */
export async function POST(req: NextRequest) {
  db();
  const body = (await req.json().catch(() => ({}))) as {
    entity?: string;
    fact_ids?: string[];
  };
  if (!body.entity) {
    return NextResponse.json(
      { error: "missing required field: entity" },
      { status: 400 },
    );
  }

  const all = getAllFactsForEntity(body.entity).filter((f) => f.known_to === null);
  const target =
    body.fact_ids && body.fact_ids.length > 0
      ? all.filter((f) => body.fact_ids!.includes(f.id))
      : all;

  if (target.length === 0) {
    return NextResponse.json({
      entity: body.entity,
      enriched: [],
      note: "no live facts to enrich",
    });
  }

  const t0 = Date.now();
  const enrichmentFacts = await runEnrichments(target, body.entity);
  const latency_ms = Date.now() - t0;

  return NextResponse.json({
    entity: body.entity,
    inputs: target.length,
    enriched: enrichmentFacts.map((f) => ({
      id: f.id,
      predicate: f.predicate,
      value: f.value,
      unit: f.unit ?? null,
      source: f.source,
      quote: f.span.quote,
      confidence: f.confidence,
    })),
    latency_ms,
  });
}
