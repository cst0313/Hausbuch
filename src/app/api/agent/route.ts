import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runAgent, processUpdate, type AgentInput } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent
 *
 * The unified agent endpoint. Accepts:
 *   { message: string, entity_id?: string, mode?: "query" | "update" }
 *
 * For voice input, use /api/agent/voice (multipart with audio file).
 */
export async function POST(req: NextRequest) {
  db();
  const body = await req.json();
  const message = body?.message;
  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const input: AgentInput = {
    message: message.trim(),
    entity_id: body.entity_id ?? undefined,
    language: body.language ?? undefined,
    conversation_history: body.history ?? undefined,
  };

  try {
    const mode = body.mode ?? "query";
    const result = mode === "update"
      ? await processUpdate(input)
      : await runAgent(input);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `Agent failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
