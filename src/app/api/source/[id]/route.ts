// path: src/app/api/source/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, getSource } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  db();
  const { id } = await ctx.params;
  const source = getSource(decodeURIComponent(id));
  if (!source) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ source });
}
