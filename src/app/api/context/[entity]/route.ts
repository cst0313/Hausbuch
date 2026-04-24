// path: src/app/api/context/[entity]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { render } from "@/lib/renderer";
import type { Detail } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entity: string }> },
) {
  db(); // ensure boot + seed
  const { entity } = await params;
  const url = new URL(req.url);
  const detail = Number(url.searchParams.get("detail") ?? "3") as Detail;
  const at = url.searchParams.get("at") ?? undefined;
  const at_valid = url.searchParams.get("at_valid") ?? at ?? undefined;
  const at_known = url.searchParams.get("at_known") ?? at ?? undefined;
  const format = url.searchParams.get("format") ?? "markdown";

  const markdown = render(decodeURIComponent(entity), {
    detail,
    at_valid,
    at_known,
  });

  if (format === "json") {
    return NextResponse.json({ entity, markdown, at_valid, at_known, detail });
  }
  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
