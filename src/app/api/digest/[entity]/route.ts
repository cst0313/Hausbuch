// path: src/app/api/digest/[entity]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { digestFor } from "@/lib/digest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ entity: string }> },
) {
  db();
  const { entity: raw } = await params;
  const entity = decodeURIComponent(raw);
  const url = new URL(req.url);

  // Default "since" = 7 days ago. Override via ?since=ISO or ?days=N.
  const sinceParam = url.searchParams.get("since");
  const days = Number(url.searchParams.get("days") ?? "7");
  const since =
    sinceParam ??
    new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const digest = digestFor(entity, since);
  return NextResponse.json(digest);
}
