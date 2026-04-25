// path: src/app/api/queue/[id]/reject/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, getProposal, logEvent, updateProposalStatus } from "@/lib/db";
import { recordAction } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/queue/[id]/reject
 *
 * Body (optional): { resolved_by?: string }
 *
 * Marks a pending proposal as rejected. Does not touch the fact store.
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

  logEvent("revoke", proposal.id, `proposal-rejected by=${resolvedBy}`);
  const updated = updateProposalStatus(proposal.id, "rejected", resolvedBy);

  recordAction({
    actor: "user",
    action: "proposal.reject",
    entity: proposal.entity,
    target: proposal.id,
    input: { kind: proposal.kind, resolved_by: resolvedBy },
  });

  return NextResponse.json({ proposal: updated });
}
