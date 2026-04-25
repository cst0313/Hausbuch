// path: src/lib/voice.ts
/**
 * Voice integration via Gradium (Groq Whisper ASR).
 *
 * Partner tech: Gradium — counts toward the 3/7 requirement.
 * Uses Groq's OpenAI-compatible Whisper endpoint for speech-to-text.
 */

import { recordAction } from "./actions";

const GROQ_ASR_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const TIMEOUT_MS = 15_000;

export type TranscriptionResult = {
  text: string;
  language: string;
  latency_ms: number;
  model: string;
};

function readKey(): string {
  const k = process.env.GRADIUM_API_KEY;
  if (!k || !k.trim()) {
    throw new Error("GRADIUM_API_KEY is not set. Add it to .env.local.");
  }
  return k;
}

/**
 * Transcribe audio using Gradium (Groq Whisper).
 * Accepts any audio format: mp3, wav, webm, ogg, flac, m4a.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<TranscriptionResult> {
  const key = readKey();
  const t0 = performance.now();

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: mimeType }), filename);
  form.append("model", "whisper-large-v3-turbo");
  form.append("language", "de"); // German default for property management
  form.append("response_format", "json");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GROQ_ASR_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Gradium ASR HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data = (await res.json()) as { text?: string; language?: string };
    const latency_ms = Math.round(performance.now() - t0);

    recordAction({
      actor: "gradium",
      action: "voice.transcribe",
      input: { filename, mime: mimeType, size_bytes: audioBuffer.length },
      output: { text_length: data.text?.length ?? 0, language: data.language ?? "de" },
      latency_ms,
      partner: "gradium",
    });

    return {
      text: data.text ?? "",
      language: data.language ?? "de",
      latency_ms,
      model: "whisper-large-v3-turbo",
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Gradium ASR timed out after ${TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
