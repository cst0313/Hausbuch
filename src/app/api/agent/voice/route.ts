import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { transcribePcm } from "@/lib/voice";
import { runAgent, type AgentInput } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/voice
 *
 * Two ways to call:
 *   1. Content-Type: application/octet-stream  → body is raw PCM (s16le mono 24kHz).
 *      The CmdK browser client uses this — it captures PCM via AudioContext.
 *   2. multipart/form-data with field `audio`   → kept for compatibility; the
 *      bytes inside are still expected to be PCM.
 *
 * The transcription is forwarded to runAgent and the combined response is
 * returned. If Gradium or the agent fails, we return a 200 with an envelope
 * the UI can render (an error message in `answer`, empty `steps[]`).
 *
 * Optional query/form param: `entity_id` to scope the agent's context.
 */
export async function POST(req: NextRequest) {
  db();

  let pcm: Buffer;
  let entityId: string | null = null;
  const contentType = req.headers.get("content-type") ?? "";

  try {
    if (contentType.startsWith("application/octet-stream")) {
      pcm = Buffer.from(await req.arrayBuffer());
      entityId = req.nextUrl.searchParams.get("entity_id");
    } else {
      const form = await req.formData();
      const audioFile = form.get("audio") as File | null;
      if (!audioFile) {
        return NextResponse.json({ error: "audio file or PCM body required" }, { status: 400 });
      }
      pcm = Buffer.from(await audioFile.arrayBuffer());
      entityId = (form.get("entity_id") as string | null) ?? null;
    }
  } catch (err) {
    return NextResponse.json(
      quotaShapedResponse({
        message: `Could not read audio body: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
  }

  if (pcm.length < 1024) {
    return NextResponse.json(
      quotaShapedResponse({
        message: "Audio buffer too short — try recording for a couple of seconds.",
      }),
    );
  }

  let transcription: Awaited<ReturnType<typeof transcribePcm>> | null = null;
  try {
    transcription = await transcribePcm(pcm);
  } catch (err) {
    return NextResponse.json(
      quotaShapedResponse({
        message:
          "Speech transcription failed (Gradium). " +
          (err instanceof Error ? err.message : String(err)),
      }),
    );
  }

  if (!transcription.text.trim()) {
    return NextResponse.json(quotaShapedResponse({
      message: "No speech detected — try speaking a bit louder or closer to the mic.",
      transcription,
    }));
  }

  // Step 2: Run the agent on the transcript. Tolerate Gemini quota exhaustion
  // so we still show the user what we heard.
  try {
    const input: AgentInput = {
      message: transcription.text,
      entity_id: entityId ?? undefined,
    };
    const agentResult = await runAgent(input);
    return NextResponse.json({ transcription, ...agentResult });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("429") ||
      msg.toLowerCase().includes("quota") ||
      msg.toLowerCase().includes("resource_exhausted")
    ) {
      return NextResponse.json(quotaShapedResponse({
        message:
          "I heard you, but the agent's daily LLM quota is exhausted. Try again after the quota resets.",
        transcription,
      }));
    }
    return NextResponse.json(quotaShapedResponse({
      message: `Voice agent failed: ${msg}`,
      transcription,
    }));
  }
}

// Build an AgentResponse-shaped envelope so the CmdK UI can render it
// uniformly, even when something went wrong upstream.
function quotaShapedResponse(opts: {
  message: string;
  transcription?: Awaited<ReturnType<typeof transcribePcm>> | null;
}) {
  return {
    answer: opts.message,
    citations: [],
    steps: [
      {
        type: "thinking",
        content: opts.message,
        ts: new Date().toISOString(),
      },
    ],
    suggestions: [],
    entities_accessed: [],
    facts_used: 0,
    model: "fallback",
    latency_ms: 0,
    transcription: opts.transcription ?? undefined,
  };
}
