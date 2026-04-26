// path: src/app/api/revoke/route.ts
/**
 * Revoke a fact the user just ingested. Closes its known_time interval and
 * (if applicable) re-opens the prior fact that this one superseded.
 * Used by the upload modal's "revoke" button on conflict rows.
 *
 * Body: { fact_id }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAction } from "@/lib/actions";
import { invalidateRecommendationsCache } from "@/lib/recommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  db();
  const body = await req.json();
  const factId: string | undefined = body?.fact_id;
  if (!factId) {
    return NextResponse.json({ error: "fact_id required" }, { status: 400 });
  }

  const t0 = performance.now();
  const now = new Date().toISOString();

  // Find the fact
  const fact = db()
    .prepare(
      `SELECT id, entity, predicate, value, valid_from, known_to, source FROM facts WHERE id = @id`,
    )
    .get({ id: factId }) as
    | {
        id: string;
        entity: string;
        predicate: string;
        value: string;
        valid_from: string | null;
        known_to: string | null;
        source: string;
      }
    | undefined;

  if (!fact) {
    return NextResponse.json({ error: "fact not found" }, { status: 404 });
  }
  if (fact.known_to) {
    return NextResponse.json({ ok: true, already_closed: true });
  }

  // Close this fact
  db()
    .prepare(`UPDATE facts SET known_to = @now WHERE id = @id`)
    .run({ id: factId, now });

  // Find any fact that this one superseded (set superseded_by = @id) and reopen it
  const superseded = db()
    .prepare(
      `SELECT id FROM facts WHERE superseded_by = @id AND known_to IS NOT NULL`,
    )
    .all({ id: factId }) as Array<{ id: string }>;
  for (const row of superseded) {
    db()
      .prepare(
        `UPDATE facts SET known_to = NULL, superseded_by = NULL WHERE id = @id`,
      )
      .run({ id: row.id });
  }

  invalidateRecommendationsCache();

  const latency_ms = Math.round(performance.now() - t0);
  recordAction({
    actor: "user",
    action: "fact.revoke",
    entity: fact.entity,
    target: fact.id,
    input: { fact_id: fact.id, predicate: fact.predicate, value: fact.value },
    output: { reopened: superseded.map((s) => s.id) },
    latency_ms,
  });

  return NextResponse.json({
    ok: true,
    revoked: fact.id,
    reopened: superseded.map((s) => s.id),
    latency_ms,
  });
}
