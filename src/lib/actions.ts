// path: src/lib/actions.ts
/**
 * Action log (FR-7, FR-10, FR-30).
 *
 * Append-only stream of every significant action: ingest, LLM calls,
 * enrichments, user approvals/rejections. Payloads are redacted (FR-30)
 * before persistence — API keys, OAuth tokens, and PII are scrubbed.
 *
 * Usage:
 *   import { recordAction } from "./actions";
 *   recordAction({ actor: "gemini", action: "llm.compose", ... });
 */

import crypto from "crypto";
import { db } from "./db";

// ── Types ───────────────────────────────────────────────────────────────────

export type ActionActor =
  | "user"
  | "ingest"
  | "reconciler"
  | "gemini"
  | "tavily"
  | "gradium"
  | "aikido"
  | "system";

export type ActionRecord = {
  id: string;
  ts: string;
  actor: ActionActor;
  action: string;
  entity: string | null;
  target: string | null;
  input: unknown;
  output: unknown;
  latency_ms: number | null;
  cost_tokens: number | null;
  cost_usd: number | null;
  partner: string | null;
};

export type RecordActionInput = {
  actor: ActionActor;
  action: string;
  entity?: string | null;
  target?: string | null;
  input?: unknown;
  output?: unknown;
  latency_ms?: number | null;
  cost_tokens?: number | null;
  cost_usd?: number | null;
  partner?: string | null;
};

// ── Redaction (FR-30) ───────────────────────────────────────────────────────

const REDACT_PATTERNS: Array<[RegExp, string]> = [
  // Google API keys (AIzaSy...)
  [/AIza[0-9A-Za-z_\-]{20,}/g, "[REDACTED:google-key]"],
  // Anthropic API keys
  [/sk-ant-[a-zA-Z0-9\-]{20,}/g, "[REDACTED:anthropic-key]"],
  // Tavily API keys
  [/tvly-[a-zA-Z0-9]{20,}/g, "[REDACTED:tavily-key]"],
  // Generic sk- style keys (OpenAI etc.)
  [/\bsk-[a-zA-Z0-9]{20,}/g, "[REDACTED:api-key]"],
  // x-goog-api-key header values in JSON
  [/(x-goog-api-key["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1[REDACTED]"],
  // Bearer tokens
  [/Bearer\s+[a-zA-Z0-9\-._~+\/]{20,}=*/gi, "Bearer [REDACTED]"],
  // Google OAuth access tokens
  [/ya29\.[a-zA-Z0-9_\-.]+/g, "[REDACTED:oauth]"],
  // api_key fields in JSON (Tavily body format: "api_key":"tvly-...")
  [/("api_key"\s*:\s*")[^"]+(")/g, "$1[REDACTED]$2"],
  // Email addresses
  [/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, "[REDACTED:email]"],
  // International phone numbers
  [/\+\d{1,3}[\s\-]?\d[\d\s\-]{6,13}/g, "[REDACTED:phone]"],
  // IBAN
  [/\b[A-Z]{2}\d{2}[\s]?[\dA-Z]{4}[\s]?[\dA-Z]{4}[\s]?[\dA-Z]{4}[\s]?[\dA-Z]{4}[\s]?[\dA-Z]{0,4}\b/g, "[REDACTED:iban]"],
  // German tax ID (Steuernummer XX/XXX/XXXXX)
  [/\b\d{2}\/\d{3}\/\d{5}\b/g, "[REDACTED:tax-id]"],
];

/**
 * Deep-redact sensitive data from a payload before it hits the actions table.
 * Works on any JSON-serializable value. Returns the redacted clone.
 */
export function redactPayload(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }

  for (const [pattern, replacement] of REDACT_PATTERNS) {
    pattern.lastIndex = 0;
    json = json.replace(pattern, replacement);
  }

  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

// ── Record ──────────────────────────────────────────────────────────────────

function newActionId(): string {
  return "act_" + crypto.randomBytes(8).toString("hex");
}

/**
 * Write one action to the append-only log. Redacts input + output (FR-30)
 * before persistence. Never throws — a logging failure must not break the
 * main application flow.
 */
export function recordAction(opts: RecordActionInput): ActionRecord | null {
  try {
    const id = newActionId();
    const ts = new Date().toISOString();
    const redactedInput = redactPayload(opts.input ?? null);
    const redactedOutput = redactPayload(opts.output ?? null);

    const row = {
      id,
      ts,
      actor: opts.actor,
      action: opts.action,
      entity: opts.entity ?? null,
      target: opts.target ?? null,
      input_json: JSON.stringify(redactedInput),
      output_json: JSON.stringify(redactedOutput),
      latency_ms: opts.latency_ms ?? null,
      cost_tokens: opts.cost_tokens ?? null,
      cost_usd: opts.cost_usd ?? null,
      partner: opts.partner ?? null,
    };

    db()
      .prepare(
        `INSERT INTO actions
           (id, ts, actor, action, entity, target, input_json, output_json,
            latency_ms, cost_tokens, cost_usd, partner)
         VALUES
           (@id, @ts, @actor, @action, @entity, @target, @input_json, @output_json,
            @latency_ms, @cost_tokens, @cost_usd, @partner)`,
      )
      .run(row);

    return {
      id,
      ts,
      actor: opts.actor,
      action: opts.action,
      entity: row.entity,
      target: row.target,
      input: redactedInput,
      output: redactedOutput,
      latency_ms: row.latency_ms,
      cost_tokens: row.cost_tokens,
      cost_usd: row.cost_usd,
      partner: row.partner,
    };
  } catch (err) {
    console.warn(`[actions] failed to record: ${String(err)}`);
    return null;
  }
}

// ── Query ───────────────────────────────────────────────────────────────────

export type ListActionsOpts = {
  entity?: string;
  actor?: string;
  action?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
};

export function listActions(opts: ListActionsOpts = {}): ActionRecord[] {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const offset = opts.offset ?? 0;
  const clauses: string[] = [];
  const args: Record<string, unknown> = { limit, offset };

  if (opts.entity) {
    clauses.push("entity = @entity");
    args.entity = opts.entity;
  }
  if (opts.actor) {
    clauses.push("actor = @actor");
    args.actor = opts.actor;
  }
  if (opts.action) {
    clauses.push("action = @action");
    args.action = opts.action;
  }
  if (opts.since) {
    clauses.push("ts >= @since");
    args.since = opts.since;
  }
  if (opts.until) {
    clauses.push("ts <= @until");
    args.until = opts.until;
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db()
    .prepare(
      `SELECT * FROM actions ${where} ORDER BY ts DESC LIMIT @limit OFFSET @offset`,
    )
    .all(args) as RawAction[];

  return rows.map(rawToAction);
}

export function getActionById(id: string): ActionRecord | null {
  const row = db()
    .prepare(`SELECT * FROM actions WHERE id = @id`)
    .get({ id }) as RawAction | undefined;
  return row ? rawToAction(row) : null;
}

export function countActions(
  opts: { entity?: string; actor?: string; since?: string } = {},
): number {
  const clauses: string[] = [];
  const args: Record<string, unknown> = {};
  if (opts.entity) {
    clauses.push("entity = @entity");
    args.entity = opts.entity;
  }
  if (opts.actor) {
    clauses.push("actor = @actor");
    args.actor = opts.actor;
  }
  if (opts.since) {
    clauses.push("ts >= @since");
    args.since = opts.since;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const row = db()
    .prepare(`SELECT COUNT(*) as cnt FROM actions ${where}`)
    .get(args) as { cnt: number };
  return row.cnt;
}

/** Timestamp of the most recent action — used by SSE polling. */
export function latestActionTs(): string | null {
  const row = db()
    .prepare(`SELECT ts FROM actions ORDER BY ts DESC LIMIT 1`)
    .get() as { ts: string } | undefined;
  return row?.ts ?? null;
}

// ── Cost estimation helpers ─────────────────────────────────────────────────

/** Gemini 2.5 Flash cost estimate (even on free tier, for transparency). */
export function estimateGeminiCost(
  tokensIn: number,
  tokensOut: number,
): number {
  return (tokensIn * 0.075 + tokensOut * 0.3) / 1_000_000;
}

/** Tavily basic search cost per call. */
export function estimateTavilyCost(): number {
  return 0.01;
}

// ── Internal ────────────────────────────────────────────────────────────────

type RawAction = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  entity: string | null;
  target: string | null;
  input_json: string | null;
  output_json: string | null;
  latency_ms: number | null;
  cost_tokens: number | null;
  cost_usd: number | null;
  partner: string | null;
};

function rawToAction(r: RawAction): ActionRecord {
  let input: unknown = null;
  let output: unknown = null;
  try {
    input = r.input_json ? JSON.parse(r.input_json) : null;
  } catch {
    input = r.input_json;
  }
  try {
    output = r.output_json ? JSON.parse(r.output_json) : null;
  } catch {
    output = r.output_json;
  }
  return {
    id: r.id,
    ts: r.ts,
    actor: r.actor as ActionActor,
    action: r.action,
    entity: r.entity,
    target: r.target,
    input,
    output,
    latency_ms: r.latency_ms,
    cost_tokens: r.cost_tokens,
    cost_usd: r.cost_usd,
    partner: r.partner,
  };
}
