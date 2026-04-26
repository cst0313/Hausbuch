// path: src/app/api/upload/commit/route.ts
/**
 * Commit a previously-previewed upload. The dashboard's review modal calls
 * /api/upload?preview=1 (or upload-bulk?preview=1) to extract without writing,
 * lets the user edit/skip facts, then POSTs the confirmed payload here.
 *
 * Body shape:
 *   {
 *     items: [{
 *       name: string,                     // file name (for the source title)
 *       kind: SourceKind,                 // "letter" | "invoice" | "email" | "note"
 *       raw_excerpt: string,              // original text (cap RAW_EXCERPT_BYTES = 128 KB)
 *       source_prior: number,             // 0..1
 *       target_entity: string,            // routed entity ID
 *       facts: Array<{
 *         predicate: string,
 *         value: string | number | boolean | null,
 *         unit?: string,
 *         valid_from?: string | null,
 *         valid_to?: string | null,
 *         quote: string,
 *       }>
 *     }]
 *   }
 *
 * Returns the source IDs created and the per-file fact-write counts.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  db,
  ident,
  insertFact,
  insertSource,
  newFactId,
  newSourceId,
} from "@/lib/db";
import { RAW_EXCERPT_BYTES, type Fact, type Source, type SourceKind } from "@/lib/types";
import { invalidateRecommendationsCache } from "@/lib/recommendations";
import { recordAction } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CommitFact = {
  predicate: string;
  value: string | number | boolean | null;
  unit?: string;
  valid_from?: string | null;
  valid_to?: string | null;
  quote: string;
};

type CommitItem = {
  name: string;
  kind: SourceKind;
  raw_excerpt: string;
  source_prior: number;
  target_entity: string;
  facts: CommitFact[];
};

export async function POST(req: NextRequest) {
  db();

  let body: { items?: CommitItem[] };
  try {
    body = (await req.json()) as { items?: CommitItem[] };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const created: Array<{ name: string; source_id: string; facts_written: number }> = [];
  let totalFacts = 0;

  for (const item of items) {
    const sourceId = newSourceId(item.name);
    const source: Source = {
      id: sourceId,
      kind: item.kind,
      title: item.name,
      ingested_at: now,
      raw_excerpt: item.raw_excerpt.slice(0, RAW_EXCERPT_BYTES),
      source_prior: clamp01(item.source_prior),
      entity_id: item.target_entity,
    };
    insertSource(source);

    let written = 0;
    for (const f of item.facts) {
      if (f.value === undefined || f.value === null || f.value === "") continue;
      const fact: Fact = {
        id: newFactId(),
        entity: item.target_entity,
        predicate: f.predicate,
        value: f.value,
        unit: f.unit,
        valid_from: f.valid_from ?? null,
        valid_to: f.valid_to ?? null,
        known_from: now,
        known_to: null,
        source: sourceId,
        span: { start: 0, end: f.quote.length, quote: f.quote },
        confidence: 0.95, // user-confirmed → high confidence
        superseded_by: null,
        ident: ident(item.target_entity, f.predicate, f.valid_from ?? null),
      };
      insertFact(fact);
      written++;
    }

    totalFacts += written;
    created.push({ name: item.name, source_id: sourceId, facts_written: written });

    recordAction({
      actor: "user",
      action: "upload.commit",
      entity: item.target_entity,
      target: sourceId,
      input: { name: item.name, kind: item.kind, facts_proposed: item.facts.length },
      output: { facts_written: written },
      latency_ms: 0,
    });
  }

  if (totalFacts > 0) invalidateRecommendationsCache();

  return NextResponse.json({
    ok: true,
    items: created,
    facts_total: totalFacts,
  });
}

function clamp01(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0.85;
  return Math.max(0, Math.min(1, n));
}
