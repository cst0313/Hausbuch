// path: src/app/api/context/[entity]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, getAllFactsForEntity, getSource } from "@/lib/db";
import { render } from "@/lib/renderer";
import { fullView } from "@/lib/query";
import type { Detail } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entity: string }> },
) {
  db(); // ensure boot + seed
  const { entity: raw } = await params;
  const entity = decodeURIComponent(raw);
  const url = new URL(req.url);
  const detail = Number(url.searchParams.get("detail") ?? "3") as Detail;
  const at = url.searchParams.get("at") ?? undefined;
  const at_valid = url.searchParams.get("at_valid") ?? at ?? undefined;
  const at_known = url.searchParams.get("at_known") ?? at ?? undefined;
  const format = url.searchParams.get("format") ?? "markdown";

  const markdown = render(entity, { detail, at_valid, at_known });

  if (format === "json" || format === "structured") {
    const facts = getAllFactsForEntity(entity);
    const view = fullView(entity, { at_valid, at_known });
    const sourceIds = new Set(facts.map((f) => f.source));
    const sources = [...sourceIds]
      .map((id) => getSource(id))
      .filter((s): s is NonNullable<ReturnType<typeof getSource>> => Boolean(s));

    return NextResponse.json({
      entity,
      markdown,
      facts,
      sources,
      view,
      at_valid,
      at_known,
      detail,
      counts: {
        facts: facts.length,
        sources: sources.length,
        conflicts:
          Object.values(view.current).filter((p) => p.kind === "conflict").length +
          Object.values(view.upcoming).filter((p) => p.kind === "conflict").length,
      },
    });
  }
  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
