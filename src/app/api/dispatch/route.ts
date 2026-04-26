// path: src/app/api/dispatch/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  db,
  ident,
  insertFact,
  insertSource,
  newFactId,
  newSourceId,
  logEvent,
} from "@/lib/db";
import { recordAction } from "@/lib/actions";
import type { Fact, Source } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/dispatch
 *
 * Body: {
 *   entity_id: "tenant:MIE-018",
 *   contractor_id: "contractor:DL-013",
 *   contractor_name: "Sanitaer Schulze GmbH",
 *   incident_type?: "water_damage",
 *   note?: string,
 * }
 *
 * Writes the dispatch as durable facts on the affected entity so subsequent
 * status-update drafts can read them and say "we have already contacted X"
 * instead of "we are looking for a contractor". Three facts land:
 *
 *   - dispatch.contractor       = <name>
 *   - dispatch.contractor_id    = <id>
 *   - incident.status           = "dispatched"   (supersedes "reported")
 *
 * Plus a kind="note" Source row for the audit log.
 */
export async function POST(req: NextRequest) {
  db();
  const body = await req.json().catch(() => ({}));
  const entity_id: string | undefined = body?.entity_id;
  const contractor_id: string | undefined = body?.contractor_id;
  const contractor_name: string | undefined = body?.contractor_name;
  const incident_type: string | undefined = body?.incident_type;
  const note: string | undefined = body?.note;

  if (!entity_id || !contractor_id || !contractor_name) {
    return NextResponse.json(
      { error: "entity_id, contractor_id, contractor_name are required" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();

  // 1. Synthetic Source row so the audit / context shows what happened.
  const sourceId = newSourceId(`dispatch-${entity_id}`);
  const incidentLabel = incident_type ?? "open issue";
  const sourceTitle = `Dispatched ${contractor_name} — ${incidentLabel}`;
  const sourceExcerpt =
    note ??
    `Manager dispatched ${contractor_name} (${contractor_id}) to address ${incidentLabel} on ${entity_id}.`;
  const source: Source = {
    id: sourceId,
    kind: "note",
    title: sourceTitle,
    ingested_at: now,
    raw_excerpt: sourceExcerpt,
    source_prior: 0.97, // explicit human action — high trust
    entity_id,
  };
  insertSource(source);

  // 2. Three facts. Each gets a stable ident keyed by valid_from = now so
  //    the reconciler supersedes any prior dispatch automatically.
  const writeFact = (predicate: string, value: string | number) => {
    const fid = newFactId();
    const fact: Fact = {
      id: fid,
      entity: entity_id,
      predicate,
      value,
      unit: undefined,
      valid_from: now,
      valid_to: null,
      known_from: now,
      known_to: null,
      source: sourceId,
      span: { start: 0, end: sourceExcerpt.length, quote: sourceExcerpt.slice(0, 200) },
      confidence: 0.99,
      superseded_by: null,
      ident: ident(entity_id, predicate, now),
    };
    insertFact(fact);
    logEvent("insert", fid, `dispatch · ${predicate}`);
  };

  writeFact("dispatch.contractor", contractor_name);
  writeFact("dispatch.contractor_id", contractor_id);
  writeFact("incident.status", "dispatched");

  recordAction({
    actor: "user",
    action: "dispatch",
    entity: entity_id,
    target: contractor_id,
    input: { contractor_name, incident_type, note },
    output: { source_id: sourceId },
    latency_ms: 0,
    partner: undefined,
  });

  return NextResponse.json({
    ok: true,
    source_id: sourceId,
    facts_written: ["dispatch.contractor", "dispatch.contractor_id", "incident.status"],
  });
}
