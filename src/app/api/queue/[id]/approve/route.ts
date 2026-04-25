// path: src/app/api/queue/[id]/approve/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  closeKnownTo,
  db,
  getProposal,
  getSource,
  ident,
  insertFact,
  insertSource,
  logEvent,
  newFactId,
  newSourceId,
  updateProposalStatus,
} from "@/lib/db";
import { emitEvent } from "@/lib/events";
import type { Fact, Source } from "@/lib/types";
import { recordAction } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/queue/[id]/approve
 *
 * Body (optional): { resolved_by?: string }
 *
 * Approves a pending proposal:
 *  - kind="add":       writes the proposed fact into the store.
 *  - kind="supersede": writes the new fact and closes the prior fact's known_to.
 *  - kind="reject":    marks the source as rejected (logged); no fact written.
 *
 * On any error, the proposal stays `pending`. We never half-update.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  db();
  const { id } = await params;

  const proposal = getProposal(id);
  if (!proposal) {
    return NextResponse.json({ error: `proposal not found: ${id}` }, { status: 404 });
  }
  if (proposal.status !== "pending") {
    return NextResponse.json(
      { error: `proposal is ${proposal.status}, not pending` },
      { status: 409 },
    );
  }

  let resolvedBy = "demo-user";
  try {
    const body = (await req.json()) as { resolved_by?: string } | null;
    if (body && typeof body.resolved_by === "string" && body.resolved_by.trim()) {
      resolvedBy = body.resolved_by.trim();
    }
  } catch {
    // empty body is fine
  }

  const now = new Date().toISOString();

  // Synthesize a source if the proposal didn't carry one. User-created
  // proposals (kind="manual") get a synthetic provenance row so the fact
  // still has a citation in the audit trail.
  let sourceId = proposal.source_id ?? null;
  if (proposal.kind !== "reject") {
    if (!sourceId) {
      const synth: Source = {
        id: newSourceId(`approval-${proposal.id}`),
        kind: "note",
        title: `Approved proposal ${proposal.id}`,
        ingested_at: now,
        raw_excerpt:
          proposal.payload.span?.quote ??
          `Manually approved by ${resolvedBy}: ${proposal.payload.predicate} = ${String(
            proposal.payload.value ?? "",
          )}`,
        source_prior: 0.85,
      };
      try {
        insertSource(synth);
      } catch (err) {
        return fail(`failed to write synthesized source: ${describe(err)}`);
      }
      sourceId = synth.id;
      emitEvent({ kind: "source.ingested", source_id: synth.id, title: synth.title });
    } else if (!getSource(sourceId)) {
      return fail(`source not found: ${sourceId}`);
    }
  }

  const writtenFactIds: string[] = [];

  try {
    if (proposal.kind === "reject") {
      // No fact written. Audit-log the rejection so /audit can surface it.
      const targetSource = proposal.payload.rejects;
      if (!targetSource) {
        return fail("payload.rejects is required for reject proposals");
      }
      logEvent("revoke", proposal.id, `source-rejected:${targetSource}`);
    } else {
      const p = proposal.payload;
      if (!p.predicate || p.value === undefined) {
        return fail("payload missing predicate or value");
      }
      if (!sourceId) {
        return fail("internal: sourceId not resolved");
      }

      // For supersede: close the prior fact's known_to BEFORE inserting the
      // new one, so a reader observing mid-write sees consistent bitemporal
      // state. (better-sqlite3 is synchronous; this still serializes.)
      if (proposal.kind === "supersede" && p.supersedes) {
        closeKnownTo(p.supersedes, now);
        logEvent("supersede", p.supersedes, `replaced via proposal ${proposal.id}`);
      }

      const factId = newFactId();
      const fact: Fact = {
        id: factId,
        entity: proposal.entity,
        predicate: p.predicate,
        value: p.value ?? null,
        unit: p.unit ?? undefined,
        valid_from: p.valid_from ?? null,
        valid_to: p.valid_to ?? null,
        known_from: now,
        known_to: null,
        source: sourceId,
        span: p.span ?? {
          start: 0,
          end: 0,
          quote:
            proposal.rationale ??
            `Approved proposal ${proposal.id} (no span provided)`,
        },
        confidence: typeof p.confidence === "number" ? p.confidence : 0.9,
        superseded_by: null,
        ident: ident(proposal.entity, p.predicate, p.valid_from ?? null),
      };
      insertFact(fact);
      logEvent("insert", factId, `actor=user:approve proposal=${proposal.id}`);
      emitEvent({
        kind: "fact.inserted",
        fact_id: factId,
        predicate: p.predicate,
        value: String(p.value ?? ""),
      });
      writtenFactIds.push(factId);
    }
  } catch (err) {
    return fail(`approval write failed: ${describe(err)}`);
  }

  const updated = updateProposalStatus(proposal.id, "approved", resolvedBy);
  if (!updated) {
    // Should be impossible (we checked pending above), but if it happens we
    // surface it loudly rather than reporting success.
    return NextResponse.json(
      {
        error:
          "fact(s) were written but proposal status update failed; investigate manually",
        written_fact_ids: writtenFactIds,
      },
      { status: 500 },
    );
  }

  recordAction({
    actor: "user",
    action: "proposal.approve",
    entity: proposal.entity,
    target: proposal.id,
    input: { kind: proposal.kind, resolved_by: resolvedBy },
    output: { written_fact_ids: writtenFactIds },
  });

  return NextResponse.json({
    proposal: updated,
    written_fact_ids: writtenFactIds,
  });
}

function fail(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
