// path: src/lib/voice.ts
/**
 * Voice integration via Gradium (gradium.ai).
 *
 * Gradium exposes ASR over a WebSocket at wss://api.gradium.ai/api/speech/asr
 * with an `x-api-key` header. Clients send a setup message, then audio chunks
 * in base64. The server replies with `text` messages (segments with timestamps)
 * and a final `end_of_stream`. We aggregate the text segments and return them
 * as a single transcription.
 *
 * Caller is expected to pass raw PCM bytes (24 kHz, mono, signed 16-bit LE).
 * The CmdK client captures audio via Web Audio API and resamples to that
 * shape before posting it to /api/agent/voice.
 *
 * Uses Node's native WebSocket (Node ≥ 21).
 */

import { recordAction } from "./actions";

const GRADIUM_WS = "wss://api.gradium.ai/api/speech/asr";
const TIMEOUT_MS = 20_000;
const CHUNK_SAMPLES = 1920; // 80 ms at 24 kHz, per Gradium spec
const CHUNK_BYTES = CHUNK_SAMPLES * 2; // int16 → 2 bytes

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
  return k.trim();
}

type GradiumMessage =
  | { type: "ready"; session_id?: string }
  | { type: "text"; text: string; start?: number; end?: number; final?: boolean }
  | { type: "end_text" }
  | { type: "step"; voice_active?: boolean }
  | { type: "end_of_stream" }
  | { type: "error"; message?: string }
  | { type: string; [k: string]: unknown };

/**
 * Transcribe a PCM buffer (24 kHz, mono, s16le) via Gradium's WebSocket.
 * Returns the concatenated transcript when the server signals end_of_stream.
 */
export async function transcribePcm(pcm: Buffer): Promise<TranscriptionResult> {
  const key = readKey();
  const t0 = performance.now();

  return new Promise<TranscriptionResult>((resolve, reject) => {
    let settled = false;
    const segments: string[] = [];
    let language = "de";

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      const latency_ms = Math.round(performance.now() - t0);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (err) {
        recordAction({
          actor: "gradium",
          action: "voice.transcribe.failed",
          input: { bytes: pcm.length },
          output: { error: err.message },
          latency_ms,
          partner: "gradium",
        });
        reject(err);
        return;
      }
      const text = segments.join(" ").replace(/\s+/g, " ").trim();
      recordAction({
        actor: "gradium",
        action: "voice.transcribe",
        input: { bytes: pcm.length },
        output: { text_length: text.length, language },
        latency_ms,
        partner: "gradium",
      });
      resolve({ text, language, latency_ms, model: "gradium-asr" });
    };

    let ws: WebSocket;
    try {
      // Native WebSocket in Node 21+ supports custom headers via the
      // `headers` option in the constructor (Node-only extension); the
      // lib.dom WebSocket type doesn't model this, so cast.
      const WSCtor = WebSocket as unknown as new (
        url: string,
        opts: { headers: Record<string, string> },
      ) => WebSocket;
      ws = new WSCtor(GRADIUM_WS, { headers: { "x-api-key": key } });
    } catch (err) {
      finish(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const timer = setTimeout(() => {
      finish(new Error(`Gradium WS timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    ws.addEventListener("open", async () => {
      // Setup message — Gradium's schema accepts exactly these three fields.
      // PCM is hard-required to be 24 kHz; there's no sample_rate field, so
      // the burden of resampling lives on the client.
      try {
        ws.send(
          JSON.stringify({
            type: "setup",
            model_name: "default",
            input_format: "pcm",
          }),
        );
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      // Stream PCM in 80ms chunks (1920 samples = 3840 bytes). We pace the
      // sends slightly so Gradium's server-side buffer doesn't get a single
      // burst that it then plays back at the wrong rate.
      try {
        for (let off = 0; off < pcm.length; off += CHUNK_BYTES) {
          const slice = pcm.subarray(off, Math.min(off + CHUNK_BYTES, pcm.length));
          ws.send(
            JSON.stringify({
              type: "audio",
              audio: slice.toString("base64"),
            }),
          );
          // Yield briefly so the WS can flush. ~5ms is enough to avoid
          // congestion without making transcription feel laggy.
          await new Promise((r) => setTimeout(r, 5));
        }
        ws.send(JSON.stringify({ type: "end_of_stream" }));
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.addEventListener("message", (evt: MessageEvent) => {
      let msg: GradiumMessage;
      try {
        msg = JSON.parse(typeof evt.data === "string" ? evt.data : String(evt.data));
      } catch {
        return;
      }
      if (msg.type === "text" && typeof msg.text === "string") {
        segments.push(msg.text);
      } else if (msg.type === "ready") {
        // session opened — nothing to do
      } else if (msg.type === "end_of_stream") {
        clearTimeout(timer);
        finish();
      } else if (msg.type === "error") {
        clearTimeout(timer);
        finish(new Error(`Gradium error: ${msg.message ?? "unknown"}`));
      }
    });

    ws.addEventListener("error", (evt: Event) => {
      clearTimeout(timer);
      finish(new Error(`Gradium WS error: ${(evt as { message?: string }).message ?? "unknown"}`));
    });

    ws.addEventListener("close", () => {
      clearTimeout(timer);
      // If we haven't already settled (e.g. server closed before end_of_stream),
      // resolve with whatever we collected.
      if (!settled) finish();
    });
  });
}

/**
 * Legacy entry point — older callers passed an opaque audio buffer + mime.
 * Kept so existing imports don't break, but it requires PCM-shaped input now
 * (the webm-recording path has been replaced by Web Audio PCM capture).
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  _filename: string,
  mimeType: string,
): Promise<TranscriptionResult> {
  if (!mimeType.includes("pcm") && !mimeType.includes("octet-stream")) {
    throw new Error(
      `Unsupported audio mime "${mimeType}" — Gradium needs raw PCM (24kHz mono s16le). ` +
        `Capture via AudioContext on the client and post as application/octet-stream.`,
    );
  }
  return transcribePcm(audioBuffer);
}
