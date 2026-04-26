import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listActions, listActionStreams, type ListActionsOpts } from "@/lib/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/audit?entity=...&actor=...&q=...&target=...&view=stream&limit=200
 *
 * - view=flat (default)   → flat list of actions, newest first
 * - view=stream           → grouped by target (one row per email/source/task)
 * - q=...                 → free-text match against entity, target, action, input, output
 */
export async function GET(req: NextRequest) {
  db();
  const opts: ListActionsOpts = {};
  const entity = req.nextUrl.searchParams.get("entity");
  const actor = req.nextUrl.searchParams.get("actor");
  const target = req.nextUrl.searchParams.get("target");
  const since = req.nextUrl.searchParams.get("since");
  const until = req.nextUrl.searchParams.get("until");
  const limit = req.nextUrl.searchParams.get("limit");
  const q = req.nextUrl.searchParams.get("q");
  const view = req.nextUrl.searchParams.get("view") ?? "flat";

  if (entity) opts.entity = entity;
  if (actor) opts.actor = actor;
  if (target) opts.target = target;
  if (since) opts.since = since;
  if (until) opts.until = until;
  if (limit) opts.limit = Number(limit);
  if (q) opts.q = q;

  if (view === "stream") {
    const streams = listActionStreams(opts);
    return NextResponse.json({ streams, count: streams.length });
  }

  const actions = listActions(opts);
  return NextResponse.json({ actions, count: actions.length });
}
