// path: src/app/api/scenarios/route.ts
import { NextResponse } from "next/server";
import { DEMO_SCENARIOS } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public manifest of the demo scenario sources. The /demo page fetches this
 * at mount time and POSTs each one to /api/ingest when the user advances.
 */
export async function GET() {
  return NextResponse.json({ scenarios: DEMO_SCENARIOS });
}
