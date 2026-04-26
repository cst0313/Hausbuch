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
    const msg = err instanceof Error ? err.message : String(err);
    // Gemini free-tier quota exhaustion — return a useful response instead of 500
    // so the UI keeps working. Surface the limit honestly.
    if (msg.includes("429") || msg.toLowerCase().includes("quota") || msg.toLowerCase().includes("resource_exhausted")) {
      return NextResponse.json({
        answer:
          "The agent's daily LLM quota is exhausted (Gemini free tier). Search results below " +
          "still work — they don't need an LLM. Bump the project to a paid quota or wait until " +
          "the quota resets to ask follow-up questions.",
        citations: [],
        steps: [
          { type: "thinking", content: "Quota exhausted — falling back without LLM call.", ts: new Date().toISOString() },
        ],
        suggestions: [],
        entities_accessed: [],
        facts_used: 0,
        model: "quota-exhausted",
        latency_ms: 0,
      });
    }
    return NextResponse.json(
      { error: `Agent failed: ${msg}` },
      { status: 500 },
    );
  }
}
