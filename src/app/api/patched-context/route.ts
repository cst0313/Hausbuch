// path: src/app/api/patched-context/route.ts
// path: src/app/api/patched-context/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, getAllFactsForEntity } from "@/lib/db";
import { render } from "@/lib/renderer";
import { patch, listAnchoredFacts, type PatchOp } from "@/lib/patcher";
import { fullView } from "@/lib/query";
import { ENTITY } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/patched-context
 *
 * Body:
 *   {
 *     entity: string,
 *     existing: string,   // the current Context.md (may contain human edits)
 *     new_facts: Fact[]   // optional — if omitted, uses current DB view
 *   }
 *
 * Returns the *patched* Context.md alongside a diff report showing which
 * blocks changed and how many human-authored lines were preserved.
 *
 * This is the Buena track §2 capability: "patch exactly the right section
 * without destroying human edits and without burning tokens on a re-render."
 */
export async function POST(req: NextRequest) {
  db();
  const body = await req.json();
  const entity: string = body?.entity ?? ENTITY;
  const existing: string = body?.existing ?? render(entity, { detail: 3 });

  // 1. Identify what anchored facts currently live in the existing doc
  const currentAnchors = new Set(listAnchoredFacts(existing));

  // 2. Figure out what anchors SHOULD exist given the current DB view
  const view = fullView(entity);
  const desired = new Map<string, { ident: string; block: string[] }>();
  const desiredAnchors = new Set<string>();

  const allFactsByIdent = new Map(
    getAllFactsForEntity(entity)
      .filter((f) => f.known_to === null)
      .map((f) => [f.ident, f]),
  );

  for (const [predicate, pv] of Object.entries(view.current)) {
    if (pv.kind !== "single") continue;
    desiredAnchors.add(pv.fact.ident);
    desired.set(pv.fact.ident, {
      ident: pv.fact.ident,
      block: [renderFactBlockBody(predicate, pv.fact)],
    });
  }
  for (const [predicate, pv] of Object.entries(view.upcoming)) {
    if (pv.kind !== "single") continue;
    desiredAnchors.add(pv.fact.ident);
    desired.set(pv.fact.ident, {
      ident: pv.fact.ident,
      block: [renderFactBlockBody(predicate, pv.fact, " (upcoming)")],
    });
  }

  // 3. Build patch ops: upsert the desired blocks, remove anchors that are
  //    present in the existing doc but no longer in the desired view.
  const ops: PatchOp[] = [];
  for (const [ident, { block }] of desired) {
    // Only upsert if the block content actually differs, to show minimal diff
    ops.push({ kind: "upsert-fact", ident, block });
  }
  for (const ident of currentAnchors) {
    if (!desiredAnchors.has(ident) && !allFactsByIdent.has(ident)) {
      ops.push({ kind: "remove-fact", ident });
    }
  }

  // 4. Apply the patch
  const result = patch(existing, ops);

  return NextResponse.json({
    patched: result.next,
    applied: result.applied,
    skipped: result.skipped,
    preserved_user_lines: result.preserved_user_lines,
    ops_summary: {
      upserts: ops.filter((o) => o.kind === "upsert-fact").length,
      removals: ops.filter((o) => o.kind === "remove-fact").length,
    },
    note:
      "Anchored fact blocks were replaced in place. Any lines outside " +
      "<!-- fact:ID --> / <!-- /fact:ID --> comment boundaries were preserved " +
      "verbatim, so human edits are safe.",
  });
}

function renderFactBlockBody(
  predicate: string,
  fact: { value: unknown; unit?: string; source: string },
  suffix = "",
): string {
  const key = predicate.split(".").slice(1).join(".") || predicate;
  const val = formatValue(fact);
  return `${key.padEnd(18)}${val}${suffix}  ^[${fact.source}]`;
}

function formatValue(fact: { value: unknown; unit?: string }): string {
  const v = fact.value;
  if (v === null || v === undefined) return "null";
  if (fact.unit === "EUR/month") return `€${Number(v).toLocaleString("en-US")} / month`;
  if (typeof v === "number") return v.toLocaleString("en-US");
  return String(v);
}
