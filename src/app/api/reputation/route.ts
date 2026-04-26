// path: src/app/api/reputation/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getReputation, getReputations, getTenantHistory } from "@/lib/reputation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reputation?entity=...                 → single entity reputation
 * GET /api/reputation?entities=a,b,c              → bulk
 * GET /api/reputation?tenant=tenant:MIE-XXX&history=1 → cross-unit history
 */
export async function GET(req: NextRequest) {
  db();
  const entity = req.nextUrl.searchParams.get("entity");
  const entities = req.nextUrl.searchParams.get("entities");
  const tenant = req.nextUrl.searchParams.get("tenant");
  const history = req.nextUrl.searchParams.get("history");

  if (tenant && history) {
    return NextResponse.json({
      entity_id: tenant,
      history: getTenantHistory(tenant),
    });
  }
  if (entities) {
    const ids = entities.split(",").map((s) => s.trim()).filter(Boolean);
    return NextResponse.json({ reputations: getReputations(ids) });
  }
  if (entity) {
    return NextResponse.json(getReputation(entity));
  }
  return NextResponse.json({ error: "missing 'entity' or 'entities' or 'tenant'" }, { status: 400 });
}
