// path: src/app/api/feedback/route.ts
/**
 * Agent feedback ingest — the self-improvement loop.
 *
 * The user 👍 / 👎 an agent answer in the command palette. We:
 *   1. Record the feedback as an audit action (so it appears in /audit and
 *      the dashboard's Live activity strip).
 *   2. Adjust the source_prior on every citation source by a bounded delta.
 *      Positive feedback nudges the prior up; negative pushes it down.
 *      Bounds keep any single feedback event from collapsing or saturating
 *      a source's trustworthiness.
 *
 * The next time the reconciler runs against those sources, the new prior is
 * already in effect — no separate retrain step. Source priors decay/grow
 * monotonically with how useful each source's claims have been to the user.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAction } from "@/lib/actions";
import { invalidateRecommendationsCache } from "@/lib/recommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bounded prior adjustments — see reconciler.ts for the full math.
const BUMP_UP = 0.02;
const BUMP_DOWN = 0.02;
const PRIOR_CEIL = 0.95;
const PRIOR_FLOOR = 0.5;

type Body = {
  question?: string;
  answer?: string;
  model?: string;
  facts_used?: number;
  /** Citation source IDs from the agent response. */
  citations?: string[];
  /** Entities the agent inspected (used to derive source IDs when citations
   *  are empty — Gemini doesn't always emit ^[…] markers reliably). */
  entities_accessed?: string[];
  rating?: "up" | "down";
  note?: string;
  entity_id?: string;
};

export async function POST(req: NextRequest) {
  db();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.rating !== "up" && body.rating !== "down") {
    return NextResponse.json({ error: "rating must be 'up' or 'down'" }, { status: 400 });
  }

  // 1. Trust explicit citations if they look like source IDs.
  const explicitCitations = (Array.isArray(body.citations) ? body.citations : []).filter(
    (c) => typeof c === "string" && c.startsWith("src_"),
  );

  // 2. Otherwise, derive source IDs from the entities the agent actually
  //    looked at — bump priors on the most recent live sources backing
  //    those entities. This is what makes feedback bite.
  const candidateSourceIds = new Set<string>(explicitCitations);
  const entityIds: string[] = [
    ...(Array.isArray(body.entities_accessed) ? body.entities_accessed : []),
    ...(body.entity_id ? [body.entity_id] : []),
  ];
  if (candidateSourceIds.size === 0 && entityIds.length > 0) {
    const placeholders = entityIds.map((_, i) => `@e${i}`).join(",");
    const args: Record<string, string> = {};
    entityIds.forEach((id, i) => (args[`e${i}`] = id));
    const rows = db()
      .prepare(
        `SELECT DISTINCT source
           FROM facts
          WHERE entity IN (${placeholders})
            AND known_to IS NULL
          ORDER BY known_from DESC
          LIMIT 8`,
      )
      .all(args) as Array<{ source: string }>;
    for (const r of rows) candidateSourceIds.add(r.source);
  }

  const delta = body.rating === "up" ? BUMP_UP : -BUMP_DOWN;

  // Update source_prior for each candidate source, bounded.
  const adjusted: Array<{ id: string; from: number; to: number }> = [];
  if (candidateSourceIds.size > 0) {
    const stmt = db().prepare(
      `UPDATE sources
         SET source_prior = MAX(@floor, MIN(@ceil, source_prior + @delta))
       WHERE id = @id`,
    );
    const select = db().prepare(`SELECT source_prior FROM sources WHERE id = @id`);
    for (const id of candidateSourceIds) {
      const before = (select.get({ id }) as { source_prior: number } | undefined)?.source_prior;
      if (before === undefined) continue;
      stmt.run({ id, delta, floor: PRIOR_FLOOR, ceil: PRIOR_CEIL });
      const after = (select.get({ id }) as { source_prior: number }).source_prior;
      adjusted.push({ id, from: before, to: after });
    }
  }

  // Reconciler results depend on source priors — bust the recs cache so the
  // dashboard reflects the new ranking next read.
  if (adjusted.length > 0) invalidateRecommendationsCache();

  recordAction({
    actor: "user",
    action: body.rating === "up" ? "agent.feedback.up" : "agent.feedback.down",
    entity: body.entity_id ?? null,
    target: null,
    input: {
      question: body.question?.slice(0, 200),
      model: body.model,
      facts_used: body.facts_used,
      citation_count: candidateSourceIds.size,
      entities_count: entityIds.length,
      note: body.note?.slice(0, 200),
    },
    output: {
      adjusted_priors: adjusted.length,
      examples: adjusted.slice(0, 3),
    },
    latency_ms: 0,
  });

  return NextResponse.json({
    ok: true,
    adjusted_priors: adjusted,
    note: `${adjusted.length} source prior${adjusted.length === 1 ? "" : "s"} updated.`,
  });
}
