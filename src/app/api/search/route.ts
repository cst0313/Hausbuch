// path: src/app/api/search/route.ts
/**
 * Fast cross-surface search for the ⌘K palette.
 *
 * Returns one bundle:
 *   - entities (tenant / owner / contractor / unit / building)
 *   - open recommendations matching the query
 *   - past audit streams whose target/entity/payload mentions the query
 *
 * Built for keystroke latency: every query is a SQL LIKE + an in-memory filter,
 * no LLM, no enrichment, no rendering. Typical p50 < 30ms on the demo corpus.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, listEntities } from "@/lib/db";
import { listActionStreams } from "@/lib/actions";
import { getRecommendations } from "@/lib/recommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Result = {
  kind: "entity" | "recommendation" | "audit";
  glyph: "tenant" | "owner" | "contractor" | "unit" | "building" | "recommendation" | "audit";
  id: string;
  name: string;
  sub: string;
  tag?: string;
  tagSev?: "critical" | "high" | "medium" | "ok";
};

export async function GET(req: NextRequest) {
  db();
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 8), 20);
  if (!q) {
    return NextResponse.json({ q: "", groups: [] });
  }

  // Tokenize the query into words for fuzzy matching
  const tokens = q.split(/\s+/).filter((t) => t.length > 0);
  const matches = (text: string) => {
    const lower = text.toLowerCase();
    return tokens.every((t) => lower.includes(t));
  };

  // 1. Entities — fast in-memory filter on cached list
  const allEntities = listEntities();
  const entityHits: Result[] = [];
  for (const e of allEntities) {
    if (entityHits.length >= limit * 2) break;
    if (!matches(`${e.id} ${e.name}`)) continue;
    if (!["tenant", "owner", "contractor", "unit", "building"].includes(e.type)) continue;
    entityHits.push({
      kind: "entity",
      glyph: e.type as Result["glyph"],
      id: e.id,
      name: e.name,
      sub: `${e.type} · ${e.id}`,
    });
  }

  // 2. Open recommendations — pre-built, just filter
  const recs = getRecommendations();
  const recHits: Result[] = [];
  for (const r of recs) {
    if (recHits.length >= limit) break;
    const haystack = `${r.entity_name} ${r.title} ${r.title_en ?? ""} ${r.summary} ${r.summary_en ?? ""}`;
    if (!matches(haystack)) continue;
    recHits.push({
      kind: "recommendation",
      glyph: "recommendation",
      id: r.id,
      name: r.title_en ?? r.title,
      sub: `${r.entity_name} · ${r.severity}`,
      tag: r.severity,
      tagSev: severityToSev(r.severity),
    });
  }

  // 3. Audit streams — query already supports `q` parameter
  const streams = listActionStreams({ q, limit: limit * 4 });
  const auditHits: Result[] = [];
  for (const s of streams) {
    if (auditHits.length >= limit) break;
    const last = s.steps[s.steps.length - 1];
    auditHits.push({
      kind: "audit",
      glyph: "audit",
      id: s.target,
      name: s.target,
      sub: `${s.steps.length} steps · last: ${last?.action ?? "?"}`,
      tag: `${s.steps.length} steps`,
      tagSev: "medium",
    });
  }

  return NextResponse.json({
    q,
    groups: [
      { title: "Entities",         items: entityHits.slice(0, limit) },
      { title: "Open recommendations", items: recHits },
      { title: "Past audit streams", items: auditHits },
    ].filter((g) => g.items.length > 0),
  });
}

function severityToSev(sev: string): Result["tagSev"] {
  if (sev === "critical") return "critical";
  if (sev === "high") return "high";
  return "medium";
}
