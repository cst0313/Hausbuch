// path: src/app/api/source/[id]/thread/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, getSource } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/source/<id>/thread
 *
 * Returns the email thread the given source belongs to: every source
 * sharing its thread_id, ordered chronologically. If the source has no
 * thread_id (rare — most synthetic emails carry one), returns just
 * the source itself in a single-element array.
 *
 * Used by the provenance drawer so the user can navigate the whole
 * conversation around an extracted fact, not just the one message it
 * came from.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const handle = db();
  const { id } = await ctx.params;
  const source = getSource(decodeURIComponent(id));
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!source.thread_id) {
    return NextResponse.json({
      thread_id: null,
      sources: [
        {
          id: source.id,
          title: source.title,
          ingested_at: source.ingested_at,
          direction: source.direction ?? null,
          from_addr: source.from_addr ?? null,
          to_addr: source.to_addr ?? null,
          excerpt: (source.raw_excerpt ?? "").slice(0, 240),
        },
      ],
    });
  }

  type Row = {
    id: string;
    title: string;
    ingested_at: string;
    direction: string | null;
    from_addr: string | null;
    to_addr: string | null;
    raw_excerpt: string;
  };
  const rows = handle
    .prepare(
      `SELECT id, title, ingested_at, direction, from_addr, to_addr, raw_excerpt
         FROM sources
        WHERE thread_id = @t
        ORDER BY ingested_at ASC`,
    )
    .all({ t: source.thread_id }) as Row[];

  return NextResponse.json({
    thread_id: source.thread_id,
    sources: rows.map((r) => ({
      id: r.id,
      title: r.title,
      ingested_at: r.ingested_at,
      direction: r.direction,
      from_addr: r.from_addr,
      to_addr: r.to_addr,
      excerpt: (r.raw_excerpt ?? "").slice(0, 240),
    })),
  });
}
