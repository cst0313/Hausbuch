// path: src/lib/llm/gemini.ts
/**
 * Gemini adapter (FR-24).
 *
 * Two entry points used by the rest of the app:
 *   - compose({ prompt, context, history?, tools? })
 *       Plain text in, plain text out. Mirrors the shape of the Anthropic
 *       call in `/api/query/route.ts` so callers can flag-switch providers.
 *   - extractFromImage({ bytes, mime, prompt? })
 *       Vision input. Used by /api/upload to OCR scanned PDFs and images.
 *
 * Constraints baked in here:
 *   - Model is read from GEMINI_MODEL with a default of `gemini-2.5-flash`.
 *     `gemini-2.5-pro` is quota=0 on the current free-tier key, so we keep the
 *     name parameterized — when billing flips on, the user just edits .env.local.
 *   - Image *generation* (Nano Banana 2 / gemini-3-pro-image-preview) is
 *     blocked. This file does not call any generation endpoint.
 *   - 20s hard cap per call. On timeout we throw a structured error, never
 *     leave the request hanging.
 *   - The API key is never returned in the result object and never logged.
 *
 * No SDK dependency added — plain fetch is sufficient for the v1beta REST
 * surface and keeps the bundle small.
 */
import { recordAction, estimateGeminiCost } from "../actions";

const DEFAULT_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 20_000;
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type ComposeInput = {
  prompt: string;
  /** System / context payload. Inlined as a prefix; we don't use systemInstruction to keep the surface flat. */
  context?: string;
  history?: Array<{ role: "user" | "model"; text: string }>;
  /**
   * Reserved for future tool-call support. Kept on the type so callers can
   * pass it without a type error; not yet wired into the request body.
   */
  tools?: unknown;
  /** Entity for action-log attribution (FR-7). */
  meta?: { entity?: string };
};

export type ComposeOutput = {
  text: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  model: string;
  raw?: unknown;
};

export type ExtractFromImageInput = {
  bytes: Buffer | Uint8Array;
  mime: string;
  /** Optional override prompt. Defaults to a careful OCR + structure prompt. */
  prompt?: string;
  /** Entity for action-log attribution (FR-7). */
  meta?: { entity?: string };
};

export type ExtractFromImageOutput = {
  text: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  model: string;
  /**
   * Kept optional — Gemini doesn't return character-level spans natively, so
   * we leave this undefined until we need them. Reserved for FR-7/FR-10.
   */
  spans?: undefined;
};

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly kind: "missing-key" | "timeout" | "http" | "shape" | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

function readKey(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k || !k.trim()) {
    throw new GeminiError(
      "GEMINI_API_KEY is not set. Add it to .env.local before calling Gemini.",
      undefined,
      "missing-key",
    );
  }
  return k;
}

function readModel(): string {
  const m = (process.env.GEMINI_MODEL ?? "").trim();
  return m || DEFAULT_MODEL;
}

/**
 * Single-line, structured breadcrumb so a future audit log can stitch the
 * action chain (FR-7/FR-10). Intentionally narrow: actor, model, latency,
 * tokens. No prompts, no responses, no key. Phase 3 wires the full /audit
 * stream; this is the shallow landing.
 */
function logCall(latency_ms: number, tokens_in: number, tokens_out: number, model: string, op: string): void {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({ actor: "gemini", op, model, latency_ms, tokens_in, tokens_out }),
  );
}

async function postJson(path: string, key: string, body: unknown): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Header form keeps the key out of the URL, so it won't show up in
        // server logs / proxy traces.
        "x-goog-api-key": key,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // Read text but never echo the URL (which would be safe here, but be defensive).
      const detail = await res.text().catch(() => "");
      throw new GeminiError(
        `Gemini HTTP ${res.status}: ${redact(detail).slice(0, 500)}`,
        undefined,
        "http",
      );
    }
    return await res.json();
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new GeminiError(`Gemini call exceeded ${TIMEOUT_MS}ms`, err, "timeout");
    }
    throw new GeminiError(
      `Gemini call failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
      "unknown",
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Conservative redaction in case an upstream error message echoes anything that looks like a key. */
function redact(s: string): string {
  return s.replace(/AIza[0-9A-Za-z_\-]{20,}/g, "AIza***REDACTED***");
}

type GeminiUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: GeminiUsage;
  promptFeedback?: { blockReason?: string };
};

function readText(resp: GeminiResponse): string {
  const cand = resp.candidates?.[0];
  if (!cand) {
    if (resp.promptFeedback?.blockReason) {
      throw new GeminiError(
        `Gemini blocked the request: ${resp.promptFeedback.blockReason}`,
        undefined,
        "shape",
      );
    }
    throw new GeminiError("Gemini returned no candidates", undefined, "shape");
  }
  const parts = cand.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("").trim();
  return text;
}

export async function compose(input: ComposeInput): Promise<ComposeOutput> {
  const key = readKey();
  const model = readModel();
  const t0 = performance.now();

  // Shape the request like a normal chat: prepend context as a system-flavoured
  // user turn, then the prior history, then the current prompt.
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  if (input.context && input.context.trim()) {
    contents.push({ role: "user", parts: [{ text: input.context }] });
    contents.push({ role: "model", parts: [{ text: "Understood. I will answer using only the document above and cite each source." }] });
  }
  for (const h of input.history ?? []) {
    contents.push({ role: h.role, parts: [{ text: h.text }] });
  }
  contents.push({ role: "user", parts: [{ text: input.prompt }] });

  // gemini-2.5-flash uses thinking tokens by default; those count toward
  // maxOutputTokens, so the visible answer was being clipped at ~80 tokens.
  // Disable thinking for compose — these are deterministic prose answers
  // that don't benefit from a thinking budget.
  const body = {
    contents,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const resp = (await postJson(`/models/${encodeURIComponent(model)}:generateContent`, key, body)) as GeminiResponse;
  const latency_ms = Math.round(performance.now() - t0);
  const text = readText(resp);
  const tokens_in = resp.usageMetadata?.promptTokenCount ?? 0;
  const tokens_out = resp.usageMetadata?.candidatesTokenCount ?? 0;

  logCall(latency_ms, tokens_in, tokens_out, model, "compose");

  recordAction({
    actor: "gemini",
    action: "llm.compose",
    entity: input.meta?.entity ?? null,
    input: { prompt: input.prompt, context_length: input.context?.length ?? 0, model },
    output: { text, tokens_in, tokens_out },
    latency_ms,
    cost_tokens: tokens_in + tokens_out,
    cost_usd: estimateGeminiCost(tokens_in, tokens_out),
    partner: "google-deepmind",
  });

  return {
    text,
    tokens_in,
    tokens_out,
    latency_ms,
    model,
    raw: undefined, // intentionally omit — keeps the API-key-free promise simple
  };
}

const DEFAULT_OCR_PROMPT =
  "Read this document carefully and transcribe every line of text exactly as written. " +
  "Preserve dates, currency amounts, names, addresses, and any numeric values verbatim. " +
  "If the document is a form, write each label and value on its own line. " +
  "Do not summarize, translate, or invent content. If a region is illegible, write [illegible].";

export async function extractFromImage(input: ExtractFromImageInput): Promise<ExtractFromImageOutput> {
  const key = readKey();
  const model = readModel();
  const t0 = performance.now();

  const b64 = Buffer.from(input.bytes).toString("base64");
  const prompt = (input.prompt ?? DEFAULT_OCR_PROMPT).trim();

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType: input.mime, data: b64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 4096,
    },
  };

  const resp = (await postJson(`/models/${encodeURIComponent(model)}:generateContent`, key, body)) as GeminiResponse;
  const latency_ms = Math.round(performance.now() - t0);
  const text = readText(resp);
  const tokens_in = resp.usageMetadata?.promptTokenCount ?? 0;
  const tokens_out = resp.usageMetadata?.candidatesTokenCount ?? 0;

  logCall(latency_ms, tokens_in, tokens_out, model, "extractFromImage");

  recordAction({
    actor: "gemini",
    action: "llm.extract",
    entity: input.meta?.entity ?? null,
    input: { mime: input.mime, byte_length: input.bytes.length, prompt: input.prompt ?? DEFAULT_OCR_PROMPT, model },
    output: { text, tokens_in, tokens_out },
    latency_ms,
    cost_tokens: tokens_in + tokens_out,
    cost_usd: estimateGeminiCost(tokens_in, tokens_out),
    partner: "google-deepmind",
  });

  return {
    text,
    tokens_in,
    tokens_out,
    latency_ms,
    model,
  };
}

/** Exposed for tests / callers that want the resolved default without importing the constant. */
export function currentModel(): string {
  return readModel();
}
