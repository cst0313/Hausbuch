// path: src/app/api/report/entity/[id]/route.ts
/**
 * Generate a Markdown history report for any entity (property, tenant, owner,
 * contractor, unit, building, weg).
 *
 *   GET /api/report/entity/{entity_id}            → text/markdown body
 *   GET /api/report/entity/{entity_id}?download=1 → attachment
 */

import { NextRequest, NextResponse } from "next/server";
import { db, getEntity, getAllFactsForEntity, listSources } from "@/lib/db";
import { listActions } from "@/lib/actions";
import { getReputation, getTenantHistory } from "@/lib/reputation";
import { render } from "@/lib/renderer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  db();
  const { id } = await ctx.params;
  const entityId = decodeURIComponent(id);
  const ent = getEntity(entityId);
  if (!ent) {
    return NextResponse.json({ error: "entity not found" }, { status: 404 });
  }

  const lines: string[] = [];
  lines.push(`# History report — ${ent.name}`);
  lines.push("");
  lines.push(`> ${ent.type} · \`${ent.id}\` · generated ${new Date().toISOString()}`);
  lines.push("");

  // Reputation block — relevant for tenants / owners / contractors
  if (["tenant", "owner", "contractor"].includes(ent.type)) {
    const rep = getReputation(entityId);
    lines.push(`## Reputation`);
    lines.push("");
    lines.push(`- **Score:** ${rep.score.toFixed(2)} · band: \`${rep.band}\``);
    lines.push(`- **Open incidents:** ${rep.incidents_open} (${rep.incidents_total} lifetime)`);
    lines.push(`- **Dunning notices:** ${rep.mahnung_count}`);
    if (rep.last_incident_at) {
      lines.push(`- **Last incident:** ${rep.last_incident_at.slice(0, 10)}`);
    }
    lines.push("");
    if (rep.flags.length > 0) {
      lines.push(`### Reputation flags`);
      lines.push("");
      for (const f of rep.flags) {
        lines.push(`- \`${f.kind}\` · ${f.note ?? "—"} · ${f.at.slice(0, 10)}`);
      }
      lines.push("");
    }
  }

  // For tenants — cross-unit history
  if (ent.type === "tenant") {
    const history = getTenantHistory(entityId);
    const unitChanges = history.filter((h) => h.predicate === "unit.tenant" && h.unit_id);
    if (unitChanges.length > 0) {
      lines.push(`## Tenancy history (cross-unit)`);
      lines.push("");
      lines.push(`| Unit | Source | Recorded |`);
      lines.push(`|---|---|---|`);
      for (const h of unitChanges.slice(0, 12)) {
        lines.push(
          `| \`${h.unit_id}\` | ${escapeMd(h.source_title ?? h.source_id)} | ${h.at.slice(0, 10)} |`,
        );
      }
      lines.push("");
    }
  }

  // Identity facts
  const facts = getAllFactsForEntity(entityId).filter((f) => f.known_to === null);
  const identity = facts.filter((f) => f.predicate.startsWith("identity."));
  if (identity.length > 0) {
    lines.push(`## Identity`);
    lines.push("");
    for (const f of identity) {
      lines.push(`- **${f.predicate.replace("identity.", "")}:** ${escapeMd(f.value)}`);
    }
    lines.push("");
  }

  // Recent activity / sources
  const allSources = listSources();
  const ownSources = allSources
    .filter((s) => s.entity_id === entityId)
    .sort((a, b) => b.ingested_at.localeCompare(a.ingested_at))
    .slice(0, 30);
  if (ownSources.length > 0) {
    lines.push(`## Recent activity (last ${ownSources.length})`);
    lines.push("");
    for (const s of ownSources) {
      lines.push(`### ${s.ingested_at.slice(0, 16).replace("T", " ")} · ${s.kind}`);
      lines.push(`**${s.title}**`);
      if (s.from_addr) lines.push(`From: ${s.from_addr}`);
      if (s.raw_excerpt) {
        lines.push("");
        lines.push("> " + s.raw_excerpt.slice(0, 400).replace(/\n/g, "\n> "));
      }
      lines.push("");
    }
  }

  // Audit log slice
  const audit = listActions({ entity: entityId, limit: 30 });
  if (audit.length > 0) {
    lines.push(`## System actions touching this entity`);
    lines.push("");
    lines.push(`| Time | Actor | Action | Latency | Partner |`);
    lines.push(`|---|---|---|---|---|`);
    for (const a of audit.slice(0, 20)) {
      lines.push(
        `| ${a.ts.slice(0, 19).replace("T", " ")} | ${a.actor} | \`${a.action}\` | ${a.latency_ms ?? "—"}ms | ${a.partner ?? "—"} |`,
      );
    }
    lines.push("");
  }

  // Append the rendered Context.md so the report is a faithful snapshot
  try {
    const ctx = render(entityId, { detail: 3 });
    lines.push(`## Context.md (current snapshot)`);
    lines.push("");
    lines.push("```markdown");
    lines.push(ctx);
    lines.push("```");
    lines.push("");
  } catch {
    /* ignore */
  }

  lines.push(`---`);
  lines.push(`_Hausbuch · property management context engine. Every fact in this report is bitemporal and source-cited._`);

  const md = lines.join("\n");
  const download = req.nextUrl.searchParams.get("download");
  const headers: Record<string, string> = {
    "Content-Type": "text/markdown; charset=utf-8",
  };
  if (download) {
    const safeId = entityId.replace(/[^a-z0-9_-]+/gi, "_");
    headers["Content-Disposition"] = `attachment; filename="hausbuch-${safeId}.md"`;
  }
  return new NextResponse(md, { headers });
}

function escapeMd(v: unknown): string {
  return String(v).replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 200);
}
