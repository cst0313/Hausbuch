import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listActions, type ListActionsOpts } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/audit?entity=...&actor=...&since=...&limit=100
 *
 * Returns the action log. Supports filtering by entity, actor, time range.
 * For SSE streaming, use /api/audit/stream (separate route).
 */
export async function GET(req: NextRequest) {
  db();
  const opts: ListActionsOpts = {};
  const entity = req.nextUrl.searchParams.get("entity");
  const actor = req.nextUrl.searchParams.get("actor");
  const since = req.nextUrl.searchParams.get("since");
  const until = req.nextUrl.searchParams.get("until");
  const limit = req.nextUrl.searchParams.get("limit");

  if (entity) opts.entity = entity;
  if (actor) opts.actor = actor;
  if (since) opts.since = since;
  if (until) opts.until = until;
  if (limit) opts.limit = Number(limit);

  const actions = listActions(opts);
  return NextResponse.json({ actions, count: actions.length });
}
