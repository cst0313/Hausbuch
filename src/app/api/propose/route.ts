// path: src/app/api/propose/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  db,
  getSource,
  insertProposal,
  newProposalId,
  type ProposalKind,
  type ProposalPayload,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS: ProposalKind[] = ["add", "supersede", "reject"];

/**
 * POST /api/propose
 *
 * Body: { entity, source_id?, kind, payload, rationale?, resolved_by? }
 *
 * Creates a pending proposal. The /queue UI lists these; approval happens via
 * /api/queue/[id]/approve. This endpoint does not touch the fact store.
 */
export async function POST(req: NextRequest) {
  db();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }

  const entity = b.entity;
  const kind = b.kind as ProposalKind;
  const payload = (b.payload ?? {}) as ProposalPayload;
  const sourceId = (b.source_id ?? null) as string | null;
  const rationale = (b.rationale ?? null) as string | null;
  const resolvedBy = (b.resolved_by ?? null) as string | null;

  if (typeof entity !== "string" || !entity) {
    return NextResponse.json({ error: "entity is required" }, { status: 400 });
  }
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${VALID_KINDS.join(", ")}` },
      { status: 400 },
    );
  }

  const validation = validatePayload(kind, payload);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  if (sourceId !== null && typeof sourceId !== "string") {
    return NextResponse.json({ error: "source_id must be a string" }, { status: 400 });
  }
  if (sourceId && !getSource(sourceId)) {
    return NextResponse.json(
      { error: `source_id not found: ${sourceId}` },
      { status: 400 },
    );
  }

  const proposal = insertProposal({
    id: newProposalId(),
    entity,
    source_id: sourceId,
    kind,
    payload,
    rationale,
    resolved_by: resolvedBy,
  });

  return NextResponse.json({ proposal }, { status: 201 });
}

function validatePayload(
  kind: ProposalKind,
  payload: ProposalPayload,
): { ok: true } | { ok: false; error: string } {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "payload must be an object" };
  }
  if (kind === "reject") {
    if (!payload.rejects || typeof payload.rejects !== "string") {
      return { ok: false, error: "payload.rejects (source id) required for kind=reject" };
    }
    return { ok: true };
  }
  // add | supersede
  if (!payload.predicate || typeof payload.predicate !== "string") {
    return { ok: false, error: "payload.predicate required" };
  }
  if (payload.value === undefined) {
    return { ok: false, error: "payload.value required (use null for absence)" };
  }
  if (kind === "supersede") {
    if (!payload.supersedes || typeof payload.supersedes !== "string") {
      return { ok: false, error: "payload.supersedes (fact id) required for kind=supersede" };
    }
  }
  return { ok: true };
}
