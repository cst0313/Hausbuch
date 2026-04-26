// path: src/app/api/ingest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingest } from "@/lib/ingest";
import type { Source } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  db();
  const body = await req.json();
  if (!body?.entity || !body?.source?.title || !body?.source?.raw_excerpt) {
    return NextResponse.json(
      { error: "missing required fields: entity, source.title, source.raw_excerpt" },
      { status: 400 },
    );
  }
  const origin = req.nextUrl.origin;
  const result = await ingest({
    entity: body.entity,
    source: {
      kind: (body.source.kind as Source["kind"]) ?? "note",
      title: body.source.title,
      raw_excerpt: body.source.raw_excerpt,
      source_prior: body.source.source_prior,
      from_addr: body.source.from_addr,
    },
    origin,
  });
  return NextResponse.json(result);
}
