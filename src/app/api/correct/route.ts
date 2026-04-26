// path: src/app/api/correct/route.ts
/**
 * Manager-driven correction. When a property manager spots a wrong fact in
 * the stream/profile panel they edit it inline and POST here. We write a new
 * fact with `source_prior=0.99` and supersede the prior current fact for
 * (entity, predicate, valid_from). The audit log records who corrected it.
 *
 * Body: { entity, predicate, value, note?, valid_from?, valid_to? }
 */

import { NextRequest, NextResponse } from "next/server";
import { db, ident, insertFact, insertSource, newFactId, newSourceId, closeKnownTo, logEvent } from "@/lib/db";
import { recordAction } from "@/lib/actions";
import { invalidateRecommendationsCache } from "@/lib/recommendations";
import { validateFactValue } from "@/lib/predicate-schemas";
import type { Fact, Source } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  db();
  const body = await req.json();
  const {
    entity,
    predicate,
    value,
    note,
    valid_from,
    valid_to,
    /** When the displayed fact is a deduped group (×N rows), pass the prior
     *  value so the server supersedes ALL live duplicates of that value, not
     *  just the most recent one. Avoids the "edit one of four" ambiguity. */
    previous_value,
  } = body ?? {};

  if (!entity || !predicate || value === undefined || value === null) {
    return NextResponse.json(
      { error: "entity, predicate and value are required" },
      { status: 400 },
    );
  }

  // Validate against the predicate schema. Reject "incident.type=skydiving"
  // and similar gibberish at the API layer.
  const validation = validateFactValue(predicate, String(value));
  if (!validation.ok) {
    return NextResponse.json(
      {
        error: validation.reason,
        predicate,
        allowed: validation.allowed,
      },
      { status: 400 },
    );
  }
  const normalizedValue = validation.normalized;

  const t0 = performance.now();
  const now = new Date().toISOString();

  // Source: a manager note. Highest source_prior so it dominates reconciliation.
  const sourceId = newSourceId(`Manager correction: ${predicate}`);
  const source: Source = {
    id: sourceId,
    kind: "note",
    title: `Manager correction · ${predicate}`,
    ingested_at: now,
    raw_excerpt: note ?? `Manager updated ${predicate} to ${normalizedValue}.`,
    source_prior: 0.99,
    entity_id: entity,
  };
  insertSource(source);

  // Find ALL existing live facts for this entity+predicate (and matching the
  // previous value if supplied) so we supersede every duplicate, not just the
  // latest. This is what makes "edit a deduped ×N row" actually correct all
  // four underlying rows.
  type ExistingRow = { id: string; valid_from: string | null; value: string | null };
  let existingRows: ExistingRow[];
  if (previous_value !== undefined && previous_value !== null) {
    existingRows = db()
      .prepare(
        `SELECT id, valid_from, value FROM facts
         WHERE entity = @entity AND predicate = @pred
           AND value = @prev AND known_to IS NULL
         ORDER BY known_from DESC`,
      )
      .all({ entity, pred: predicate, prev: String(previous_value) }) as ExistingRow[];
  } else {
    existingRows = db()
      .prepare(
        `SELECT id, valid_from, value FROM facts
         WHERE entity = @entity AND predicate = @pred AND known_to IS NULL
         ORDER BY known_from DESC LIMIT 1`,
      )
      .all({ entity, pred: predicate }) as ExistingRow[];
  }
  const existing = existingRows[0];

  // Insert the corrected fact
  const factId = newFactId();
  const fact: Fact = {
    id: factId,
    entity,
    predicate,
    value: normalizedValue,
    valid_from: valid_from ?? existing?.valid_from ?? null,
    valid_to: valid_to ?? null,
    known_from: now,
    known_to: null,
    source: sourceId,
    span: { start: 0, end: normalizedValue.length, quote: normalizedValue },
    confidence: 0.99,
    superseded_by: null,
    ident: ident(entity, predicate, valid_from ?? existing?.valid_from ?? null),
  };
  insertFact(fact);
  logEvent("insert", factId, `correction · ${predicate}=${normalizedValue}`);

  for (const row of existingRows) {
    closeKnownTo(row.id, now);
    logEvent("supersede", row.id, `superseded by manager correction ${factId}`);
  }

  invalidateRecommendationsCache();

  const latency_ms = Math.round(performance.now() - t0);
  recordAction({
    actor: "user",
    action: "fact.correct",
    entity,
    target: predicate,
    input: { predicate, value: normalizedValue, previous_value, note },
    output: {
      fact_id: factId,
      superseded: existingRows.map((r) => r.id),
      superseded_count: existingRows.length,
    },
    latency_ms,
  });

  return NextResponse.json({
    ok: true,
    fact_id: factId,
    superseded: existingRows.map((r) => r.id),
    superseded_count: existingRows.length,
    latency_ms,
  });
}
