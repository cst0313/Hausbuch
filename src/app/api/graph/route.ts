// path: src/app/api/graph/route.ts
// path: src/app/api/graph/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buildGraph, buildVFS } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  db();
  const entity = req.nextUrl.searchParams.get("entity") ?? undefined;
  const vfs = req.nextUrl.searchParams.get("vfs") === "1";
  if (vfs) {
    return NextResponse.json(buildVFS());
  }
  return NextResponse.json(buildGraph(entity));
}
