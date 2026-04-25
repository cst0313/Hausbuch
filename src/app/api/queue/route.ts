// path: src/app/api/queue/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, listProposals, type ProposalStatus } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: ProposalStatus[] = [
  "pending",
  "approved",
  "rejected",
  "superseded",
];

/**
 * GET /api/queue?entity=&status=&limit=
 *
 * Returns proposals newest-first. Defaults to status=pending, limit=50.
 */
export async function GET(req: NextRequest) {
  db();
  const url = req.nextUrl;
  const entity = url.searchParams.get("entity") ?? undefined;
  const statusParam = url.searchParams.get("status") ?? "pending";
  const limitParam = url.searchParams.get("limit");

  if (!VALID_STATUSES.includes(statusParam as ProposalStatus)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }
  const status = statusParam as ProposalStatus;

  let limit: number | undefined = undefined;
  if (limitParam !== null) {
    const n = Number(limitParam);
    if (!Number.isFinite(n) || n < 1) {
      return NextResponse.json(
        { error: "limit must be a positive integer" },
        { status: 400 },
      );
    }
    limit = Math.floor(n);
  }

  const proposals = listProposals({ entity, status, limit });
  return NextResponse.json({ proposals });
}
