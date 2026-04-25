import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { transcribeAudio } from "@/lib/voice";
import { runAgent, type AgentInput } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/voice
 *
 * Accepts multipart/form-data with an audio file.
 * Transcribes via Gradium (Groq Whisper), then runs the agent.
 *
 * Form fields:
 *   - audio: File (mp3, wav, webm, ogg)
 *   - entity_id: string (optional)
 */
export async function POST(req: NextRequest) {
  db();
  const form = await req.formData();
  const audioFile = form.get("audio") as File | null;
  if (!audioFile) {
    return NextResponse.json({ error: "audio file is required" }, { status: 400 });
  }

  const entityId = form.get("entity_id") as string | null;

  try {
    // Step 1: Transcribe via Gradium
    const buf = Buffer.from(await audioFile.arrayBuffer());
    const transcription = await transcribeAudio(
      buf,
      audioFile.name || "audio.webm",
      audioFile.type || "audio/webm",
    );

    if (!transcription.text.trim()) {
      return NextResponse.json({
        error: "No speech detected",
        transcription,
      }, { status: 422 });
    }

    // Step 2: Run agent with transcribed text
    const input: AgentInput = {
      message: transcription.text,
      entity_id: entityId ?? undefined,
    };
    const agentResult = await runAgent(input);

    return NextResponse.json({
      transcription,
      ...agentResult,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Voice agent failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
