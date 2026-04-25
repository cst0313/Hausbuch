import { NextRequest, NextResponse } from "next/server";
import { db, listEntities } from "@/lib/db";
import type { EntityType } from "@/lib/types";

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
