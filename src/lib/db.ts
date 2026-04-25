// path: src/lib/db.ts
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import type { Entity, EntityType, Fact, FactEvent, FactEventKind, FactValue, Source } from "./types";

/**
 * Hausbuch storage. Single SQLite file. Append-only facts (one row per fact-event).
 * A compact `current` view projects the live set.
 */

let _db: Database.Database | null = null;
let _seeded = false;

export function closeDb(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      // already closed
    }
  }
  _db = null;
  _seeded = false;
}

const DB_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "hausbuch.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entities (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  name       TEXT NOT NULL,
  parent_id  TEXT,
  meta_json  TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entities_type   ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_parent ON entities(parent_id);

CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT,
  ingested_at   TEXT NOT NULL,
  raw_excerpt   TEXT NOT NULL,
  source_prior  REAL NOT NULL,
  entity_id     TEXT,
  thread_id     TEXT,
  category      TEXT,
  direction     TEXT,
  from_addr     TEXT,
  to_addr       TEXT
);

CREATE TABLE IF NOT EXISTS facts (
  id              TEXT PRIMARY KEY,
  entity          TEXT NOT NULL,
  predicate       TEXT NOT NULL,
  value           TEXT,
  unit            TEXT,
  valid_from      TEXT,
  valid_to        TEXT,
  known_from      TEXT NOT NULL,
  known_to        TEXT,
  source          TEXT NOT NULL,
  span_start      INTEGER NOT NULL,
  span_end        INTEGER NOT NULL,
  span_quote      TEXT NOT NULL,
  confidence      REAL NOT NULL,
  superseded_by   TEXT,
  ident           TEXT NOT NULL,
  FOREIGN KEY (source) REFERENCES sources(id)
);

CREATE INDEX IF NOT EXISTS idx_facts_entity      ON facts(entity);
CREATE INDEX IF NOT EXISTS idx_facts_ident       ON facts(ident);
CREATE INDEX IF NOT EXISTS idx_facts_predicate   ON facts(entity, predicate);
CREATE INDEX IF NOT EXISTS idx_facts_known       ON facts(known_from, known_to);
CREATE INDEX IF NOT EXISTS idx_facts_valid       ON facts(valid_from, valid_to);

CREATE TABLE IF NOT EXISTS fact_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  kind       TEXT NOT NULL,
  fact_id    TEXT NOT NULL,
  note       TEXT,
  FOREIGN KEY (fact_id) REFERENCES facts(id)
);

CREATE INDEX IF NOT EXISTS idx_events_at    ON fact_events(at);
CREATE INDEX IF NOT EXISTS idx_events_fact  ON fact_events(fact_id);

CREATE TABLE IF NOT EXISTS proposals (
  id            TEXT PRIMARY KEY,
  entity        TEXT NOT NULL,
  source_id     TEXT,
  kind          TEXT NOT NULL CHECK(kind IN ('add','supersede','reject')),
  payload_json  TEXT NOT NULL,
  rationale     TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','approved','rejected','superseded')),
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER,
  resolved_by   TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE INDEX IF NOT EXISTS idx_proposals_entity_status
  ON proposals(entity, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_status_created
  ON proposals(status, created_at DESC);

-- Agent T (FR-25): cache for live Tavily enrichments. 24h TTL enforced by
-- expires_at column — reads ignore expired rows.
CREATE TABLE IF NOT EXISTS enrichment_cache (
  cache_key      TEXT PRIMARY KEY,        -- "<enrichment_kind>|<normalized_input>"
  enrichment_kind TEXT NOT NULL,          -- e.g. "mietpreisbremse_cap"
  input_norm     TEXT NOT NULL,           -- normalized input (zip, slugged company, etc.)
  payload_json   TEXT NOT NULL,           -- serialized enrichment result
  fetched_at     TEXT NOT NULL,           -- ISO timestamp of the live lookup
  expires_at     TEXT NOT NULL            -- ISO timestamp; reads ignore rows past this
);

CREATE INDEX IF NOT EXISTS idx_enrichment_kind    ON enrichment_cache(enrichment_kind);
CREATE INDEX IF NOT EXISTS idx_enrichment_expires ON enrichment_cache(expires_at);

-- Phase 3 (FR-7): append-only action log for transparency + audit.
-- Every significant system action is recorded here with redacted payloads.
CREATE TABLE IF NOT EXISTS actions (
  id           TEXT PRIMARY KEY,
  ts           TEXT NOT NULL,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity       TEXT,
  target       TEXT,
  input_json   TEXT,
  output_json  TEXT,
  latency_ms   INTEGER,
  cost_tokens  INTEGER,
  cost_usd     REAL,
  partner      TEXT
);

CREATE INDEX IF NOT EXISTS idx_actions_ts     ON actions(ts);
CREATE INDEX IF NOT EXISTS idx_actions_entity ON actions(entity);
CREATE INDEX IF NOT EXISTS idx_actions_actor  ON actions(actor);
`;

export function db(): Database.Database {
  if (_db) return _db;
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.exec(SCHEMA);
  if (!_seeded) {
    _seeded = true;
    // Synchronous seed so API handlers that call db() never race
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const seed = require("./seed") as { seedIfEmpty: (db: Database.Database) => void };
      seed.seedIfEmpty(_db);
    } catch (err) {
      console.error("[hausbuch] seed failed:", err);
    }
  }
  return _db;
}

export function ident(entity: string, predicate: string, validFrom: string | null | undefined): string {
  const key = `${entity}|${predicate}|${validFrom ?? ""}`;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function newFactId(): string {
  return "fact_" + crypto.randomBytes(8).toString("hex");
}

export function newSourceId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `src_${slug}_${crypto.randomBytes(3).toString("hex")}`;
}

export function newProposalId(): string {
  return "prop_" + crypto.randomBytes(8).toString("hex");
}

export function insertSource(s: Source): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO sources
         (id, kind, title, url, ingested_at, raw_excerpt, source_prior,
          entity_id, thread_id, category, direction, from_addr, to_addr)
       VALUES
         (@id, @kind, @title, @url, @ingested_at, @raw_excerpt, @source_prior,
          @entity_id, @thread_id, @category, @direction, @from_addr, @to_addr)`
    )
    .run({
      id: s.id,
      kind: s.kind,
      title: s.title,
      url: s.url ?? null,
      ingested_at: s.ingested_at,
      raw_excerpt: s.raw_excerpt,
      source_prior: s.source_prior,
      entity_id: s.entity_id ?? null,
      thread_id: s.thread_id ?? null,
      category: s.category ?? null,
      direction: s.direction ?? null,
      from_addr: s.from_addr ?? null,
      to_addr: s.to_addr ?? null,
    });
}

// ── Entities ──────────────────────────────────────────────────────────────────

export function insertEntity(e: Entity): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO entities (id, type, name, parent_id, meta_json, created_at)
       VALUES (@id, @type, @name, @parent_id, @meta_json, @created_at)`
    )
    .run({
      id: e.id,
      type: e.type,
      name: e.name,
      parent_id: e.parent_id ?? null,
      meta_json: e.meta ? JSON.stringify(e.meta) : null,
      created_at: e.created_at,
    });
}

export function getEntity(id: string): Entity | null {
  const row = db()
    .prepare(`SELECT * FROM entities WHERE id = @id`)
    .get({ id }) as RawEntity | undefined;
  return row ? rawToEntity(row) : null;
}

export function listEntities(opts: {
  type?: EntityType;
  parent_id?: string;
} = {}): Entity[] {
  const clauses: string[] = [];
  const args: Record<string, unknown> = {};
  if (opts.type) { clauses.push("type = @type"); args.type = opts.type; }
  if (opts.parent_id) { clauses.push("parent_id = @parent_id"); args.parent_id = opts.parent_id; }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db()
    .prepare(`SELECT * FROM entities ${where} ORDER BY name ASC`)
    .all(args) as RawEntity[];
  return rows.map(rawToEntity);
}

type RawEntity = {
  id: string;
  type: string;
  name: string;
  parent_id: string | null;
  meta_json: string | null;
  created_at: string;
};

function rawToEntity(r: RawEntity): Entity {
  let meta: Record<string, unknown> | undefined;
  try { meta = r.meta_json ? JSON.parse(r.meta_json) : undefined; } catch { meta = undefined; }
  return {
    id: r.id,
    type: r.type as EntityType,
    name: r.name,
    parent_id: r.parent_id,
    meta,
    created_at: r.created_at,
  };
}

export function insertFact(f: Fact): void {
  db()
    .prepare(
      `INSERT INTO facts (id, entity, predicate, value, unit, valid_from, valid_to,
                          known_from, known_to, source, span_start, span_end, span_quote,
                          confidence, superseded_by, ident)
       VALUES (@id, @entity, @predicate, @value, @unit, @valid_from, @valid_to,
               @known_from, @known_to, @source, @span_start, @span_end, @span_quote,
               @confidence, @superseded_by, @ident)`
    )
    .run({
      id: f.id,
      entity: f.entity,
      predicate: f.predicate,
      value: serializeValue(f.value),
      unit: f.unit ?? null,
      valid_from: f.valid_from ?? null,
      valid_to: f.valid_to ?? null,
      known_from: f.known_from,
      known_to: f.known_to ?? null,
      source: f.source,
      span_start: f.span.start,
      span_end: f.span.end,
      span_quote: f.span.quote,
      confidence: f.confidence,
      superseded_by: f.superseded_by ?? null,
      ident: f.ident,
    });
}

export function logEvent(kind: FactEventKind, factId: string, note?: string): void {
  db()
    .prepare(
      `INSERT INTO fact_events (at, kind, fact_id, note) VALUES (@at, @kind, @fact_id, @note)`
    )
    .run({
      at: new Date().toISOString(),
      kind,
      fact_id: factId,
      note: note ?? null,
    });
}

export function setSupersededBy(factId: string, successorId: string): void {
  db()
    .prepare(`UPDATE facts SET superseded_by = @successor WHERE id = @id`)
    .run({ id: factId, successor: successorId });
}

export function closeKnownTo(factId: string, knownTo: string): void {
  db()
    .prepare(`UPDATE facts SET known_to = @known_to WHERE id = @id AND known_to IS NULL`)
    .run({ id: factId, known_to: knownTo });
}

export function getAllFactsForEntity(entity: string): Fact[] {
  const rows = db()
    .prepare(`SELECT * FROM facts WHERE entity = @entity ORDER BY known_from ASC`)
    .all({ entity }) as RawFact[];
  return rows.map(rawToFact);
}

export function getSource(id: string): Source | null {
  const row = db()
    .prepare(`SELECT * FROM sources WHERE id = @id`)
    .get({ id }) as RawSource | undefined;
  if (!row) return null;
  return rawToSource(row);
}

function rawToSource(r: RawSource): Source {
  return {
    id: r.id,
    kind: r.kind as Source["kind"],
    title: r.title,
    url: r.url ?? undefined,
    ingested_at: r.ingested_at,
    raw_excerpt: r.raw_excerpt,
    source_prior: r.source_prior,
    entity_id: r.entity_id ?? undefined,
    thread_id: r.thread_id ?? undefined,
    category: r.category ?? undefined,
    direction: (r.direction as Source["direction"]) ?? undefined,
    from_addr: r.from_addr ?? undefined,
    to_addr: r.to_addr ?? undefined,
  };
}

export function listSources(): Source[] {
  const rows = db().prepare(`SELECT * FROM sources ORDER BY ingested_at ASC`).all() as RawSource[];
  return rows.map(rawToSource);
}

// ── Proposals (FR-18) ──────────────────────────────────────────────────────

export type ProposalKind = "add" | "supersede" | "reject";
export type ProposalStatus = "pending" | "approved" | "rejected" | "superseded";

export type Proposal = {
  id: string;
  entity: string;
  source_id: string | null;
  kind: ProposalKind;
  payload: ProposalPayload;
  rationale: string | null;
  status: ProposalStatus;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
};

/**
 * The shape of a proposal's payload depends on its kind.
 * - "add":       describes a new fact to insert.
 * - "supersede": same as "add", but also closes `supersedes` (existing fact id).
 * - "reject":    marks `rejects` (an existing source id) as untrusted; no fact is written.
 */
export type ProposalPayload = {
  predicate?: string;
  value?: FactValue;
  unit?: string;
  valid_from?: string | null;
  valid_to?: string | null;
  span?: { start: number; end: number; quote: string };
  confidence?: number;
  /** Existing fact id this proposal supersedes (kind="supersede"). */
  supersedes?: string;
  /** Existing source id this proposal rejects (kind="reject"). */
  rejects?: string;
};

type RawProposal = {
  id: string;
  entity: string;
  source_id: string | null;
  kind: string;
  payload_json: string;
  rationale: string | null;
  status: string;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
};

function rawToProposal(r: RawProposal): Proposal {
  let payload: ProposalPayload = {};
  try {
    payload = JSON.parse(r.payload_json) as ProposalPayload;
  } catch {
    payload = {};
  }
  return {
    id: r.id,
    entity: r.entity,
    source_id: r.source_id,
    kind: r.kind as ProposalKind,
    payload,
    rationale: r.rationale,
    status: r.status as ProposalStatus,
    created_at: r.created_at,
    resolved_at: r.resolved_at,
    resolved_by: r.resolved_by,
  };
}

export function insertProposal(p: {
  id: string;
  entity: string;
  source_id?: string | null;
  kind: ProposalKind;
  payload: ProposalPayload;
  rationale?: string | null;
  resolved_by?: string | null;
}): Proposal {
  const row = {
    id: p.id,
    entity: p.entity,
    source_id: p.source_id ?? null,
    kind: p.kind,
    payload_json: JSON.stringify(p.payload ?? {}),
    rationale: p.rationale ?? null,
    status: "pending",
    created_at: Date.now(),
    resolved_at: null as number | null,
    resolved_by: p.resolved_by ?? null,
  };
  db()
    .prepare(
      `INSERT INTO proposals
         (id, entity, source_id, kind, payload_json, rationale, status, created_at, resolved_at, resolved_by)
       VALUES
         (@id, @entity, @source_id, @kind, @payload_json, @rationale, @status, @created_at, @resolved_at, @resolved_by)`,
    )
    .run(row);
  return rawToProposal(row as RawProposal);
}

export function getProposal(id: string): Proposal | null {
  const row = db()
    .prepare(`SELECT * FROM proposals WHERE id = @id`)
    .get({ id }) as RawProposal | undefined;
  return row ? rawToProposal(row) : null;
}

export function listProposals(opts: {
  entity?: string;
  status?: ProposalStatus;
  limit?: number;
} = {}): Proposal[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const clauses: string[] = [];
  const args: Record<string, unknown> = { limit };
  if (opts.entity) {
    clauses.push("entity = @entity");
    args.entity = opts.entity;
  }
  if (opts.status) {
    clauses.push("status = @status");
    args.status = opts.status;
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db()
    .prepare(
      `SELECT * FROM proposals ${where} ORDER BY created_at DESC LIMIT @limit`,
    )
    .all(args) as RawProposal[];
  return rows.map(rawToProposal);
}

export function updateProposalStatus(
  id: string,
  status: ProposalStatus,
  resolvedBy: string,
): Proposal | null {
  db()
    .prepare(
      `UPDATE proposals
         SET status = @status,
             resolved_at = @resolved_at,
             resolved_by = @resolved_by
       WHERE id = @id AND status = 'pending'`,
    )
    .run({
      id,
      status,
      resolved_at: Date.now(),
      resolved_by: resolvedBy,
    });
  return getProposal(id);
}

// ── Enrichment cache (FR-25) ────────────────────────────────────────────────
// Used by src/lib/enrich.ts to keep Tavily lookups polite (24h TTL).

export type EnrichmentCacheRow = {
  cache_key: string;
  enrichment_kind: string;
  input_norm: string;
  payload_json: string;
  fetched_at: string;
  expires_at: string;
};

export function getEnrichmentCache(
  kind: string,
  inputNorm: string,
): EnrichmentCacheRow | null {
  const cacheKey = `${kind}|${inputNorm}`;
  const row = db()
    .prepare(
      `SELECT * FROM enrichment_cache
       WHERE cache_key = @cache_key AND expires_at > @now`,
    )
    .get({ cache_key: cacheKey, now: new Date().toISOString() }) as
    | EnrichmentCacheRow
    | undefined;
  return row ?? null;
}

export function setEnrichmentCache(
  kind: string,
  inputNorm: string,
  payload: unknown,
  ttlMs = 24 * 60 * 60 * 1000,
): void {
  const cacheKey = `${kind}|${inputNorm}`;
  const now = new Date();
  db()
    .prepare(
      `INSERT OR REPLACE INTO enrichment_cache
         (cache_key, enrichment_kind, input_norm, payload_json, fetched_at, expires_at)
       VALUES (@cache_key, @kind, @input_norm, @payload_json, @fetched_at, @expires_at)`,
    )
    .run({
      cache_key: cacheKey,
      kind,
      input_norm: inputNorm,
      payload_json: JSON.stringify(payload),
      fetched_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlMs).toISOString(),
    });
}

export function listEvents(limit = 50): FactEvent[] {
  const rows = db()
    .prepare(`SELECT * FROM fact_events ORDER BY id DESC LIMIT @limit`)
    .all({ limit }) as Array<{ id: number; at: string; kind: FactEventKind; fact_id: string; note: string | null }>;
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    kind: r.kind,
    fact_id: r.fact_id,
    note: r.note ?? undefined,
  }));
}

type RawFact = {
  id: string;
  entity: string;
  predicate: string;
  value: string | null;
  unit: string | null;
  valid_from: string | null;
  valid_to: string | null;
  known_from: string;
  known_to: string | null;
  source: string;
  span_start: number;
  span_end: number;
  span_quote: string;
  confidence: number;
  superseded_by: string | null;
  ident: string;
};

type RawSource = {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  ingested_at: string;
  raw_excerpt: string;
  source_prior: number;
  entity_id: string | null;
  thread_id: string | null;
  category: string | null;
  direction: string | null;
  from_addr: string | null;
  to_addr: string | null;
};

function serializeValue(v: Fact["value"]): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function rawToFact(r: RawFact): Fact {
  return {
    id: r.id,
    entity: r.entity,
    predicate: r.predicate,
    value: r.value,
    unit: r.unit ?? undefined,
    valid_from: r.valid_from,
    valid_to: r.valid_to,
    known_from: r.known_from,
    known_to: r.known_to,
    source: r.source,
    span: { start: r.span_start, end: r.span_end, quote: r.span_quote },
    confidence: r.confidence,
    superseded_by: r.superseded_by,
    ident: r.ident,
  };
}
