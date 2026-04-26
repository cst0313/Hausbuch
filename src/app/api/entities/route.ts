import { NextRequest, NextResponse } from "next/server";
import {
  db,
  ident,
  insertEntity,
  insertFact,
  insertSource,
  listEntities,
  newFactId,
  newSourceId,
} from "@/lib/db";
import type { Entity, EntityType, Fact, Source } from "@/lib/types";
import { recordAction } from "@/lib/actions";
import { invalidateRecommendationsCache } from "@/lib/recommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/entities?type=unit&parent_id=building:HAUS-12
 *
 * List entities, optionally filtered by type and/or parent.
 */
export async function GET(req: NextRequest) {
  db();
  const type = req.nextUrl.searchParams.get("type") as EntityType | null;
  const parent_id = req.nextUrl.searchParams.get("parent_id");
  const entities = listEntities({
    type: type ?? undefined,
    parent_id: parent_id ?? undefined,
  });
  return NextResponse.json({ entities });
}

/**
 * POST /api/entities
 *
 * Body: { type, name, parent_id?, identity?: Record<string,string>, meta?: Record<string,unknown> }
 *
 * Creates a new entity (contractor, tenant, owner, unit, building) and
 * writes the supplied identity fields as `identity.*` facts attributed to a
 * synthetic `manual_entry` source. Returns the entity id.
 */
export async function POST(req: NextRequest) {
  db();

  let body: {
    type?: string;
    name?: string;
    parent_id?: string | null;
    identity?: Record<string, string | undefined>;
    meta?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const allowed: EntityType[] = ["tenant", "owner", "unit", "building", "contractor"];
  if (!body.type || !allowed.includes(body.type as EntityType)) {
    return NextResponse.json(
      { error: `type must be one of ${allowed.join(", ")}` },
      { status: 400 },
    );
  }
  const type = body.type as EntityType;

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Slugify name → entity id; fall back to a timestamp suffix if collision.
  const slug = slugify(name);
  let id = `${type}:${slug}`;
  if (db().prepare(`SELECT 1 FROM entities WHERE id = @id`).get({ id })) {
    id = `${type}:${slug}-${Date.now().toString(36)}`;
  }

  const now = new Date().toISOString();

  const entity: Entity = {
    id,
    type,
    name,
    parent_id: body.parent_id ?? null,
    meta: body.meta,
    created_at: now,
  };
  insertEntity(entity);

  // Synthetic source so every fact has provenance
  const sourceTitle = `Manual entry: ${name}`;
  const source: Source = {
    id: newSourceId(`manual:${id}:${now}`),
    kind: "stammdaten",
    title: sourceTitle,
    ingested_at: now,
    raw_excerpt: `Created via "Add ${type}" form.`,
    source_prior: 0.95,
    entity_id: id,
  };
  insertSource(source);

  // Write identity facts
  const identityFields = body.identity ?? {};
  const writtenFacts: Array<{ predicate: string; value: string }> = [];
  for (const [key, raw] of Object.entries(identityFields)) {
    if (raw === undefined || raw === null) continue;
    const value = String(raw).trim();
    if (!value) continue;
    const predicate = key.startsWith("identity.") ? key : `identity.${key}`;
    const fact: Fact = {
      id: newFactId(),
      entity: id,
      predicate,
      value,
      unit: undefined,
      valid_from: null,
      valid_to: null,
      known_from: now,
      known_to: null,
      source: source.id,
      span: { start: 0, end: value.length, quote: value },
      confidence: 0.95,
      superseded_by: null,
      ident: ident(id, predicate, null),
    };
    insertFact(fact);
    writtenFacts.push({ predicate, value });
  }

  recordAction({
    actor: "user",
    action: "entity.create",
    entity: id,
    target: id,
    input: { type, name, fields: Object.keys(identityFields) },
    output: { facts: writtenFacts.length },
    latency_ms: 0,
  });

  invalidateRecommendationsCache();

  return NextResponse.json({
    entity,
    facts: writtenFacts,
    source_id: source.id,
  });
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "entity";
}
