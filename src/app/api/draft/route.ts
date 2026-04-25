import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { draftEmail, type DraftRequest } from "@/lib/drafter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/draft
 *
 * Generate a draft email via Gemini. Body: DraftRequest shape.
 * Returns the drafted email body + metadata.
 */
export async function POST(req: NextRequest) {
  db();
  const body = (await req.json()) as DraftRequest;
  if (!body?.to || !body?.subject || !body?.incident_summary) {
    return NextResponse.json(
      { error: "to, subject, and incident_summary are required" },
      { status: 400 },
    );
  }

  try {
    const result = await draftEmail(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `Draft failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
