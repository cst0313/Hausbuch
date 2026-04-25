import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getRecommendations } from "@/lib/recommendations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/recommendations
 *
 * Returns prioritized incident recommendations with suggested actions.
 * Pure fact-store queries — no LLM calls. Lightning fast.
 */
export async function GET() {
  db();
  const t0 = performance.now();
  const recommendations = getRecommendations();
  const latency_ms = Math.round(performance.now() - t0);
  return NextResponse.json({
    recommendations,
    count: recommendations.length,
    latency_ms,
  });
}
