// path: src/lib/db.ts
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import type { Fact, FactEvent, FactEventKind, Source } from "./types";

/**
 * Lumen storage. Single SQLite file. Append-only facts (one row per fact-event).
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
const DB_PATH = path.join(DB_DIR, "lumen.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT,
  ingested_at   TEXT NOT NULL,
  raw_excerpt   TEXT NOT NULL,
  source_prior  REAL NOT NULL
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
      console.error("[lumen] seed failed:", err);
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

export function insertSource(s: Source): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO sources (id, kind, title, url, ingested_at, raw_excerpt, source_prior)
       VALUES (@id, @kind, @title, @url, @ingested_at, @raw_excerpt, @source_prior)`
    )
    .run({
      id: s.id,
      kind: s.kind,
      title: s.title,
      url: s.url ?? null,
      ingested_at: s.ingested_at,
      raw_excerpt: s.raw_excerpt,
      source_prior: s.source_prior,
    });
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
  return {
    id: row.id,
    kind: row.kind as Source["kind"],
    title: row.title,
    url: row.url ?? undefined,
    ingested_at: row.ingested_at,
    raw_excerpt: row.raw_excerpt,
    source_prior: row.source_prior,
  };
}

export function listSources(): Source[] {
  const rows = db().prepare(`SELECT * FROM sources ORDER BY ingested_at ASC`).all() as RawSource[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as Source["kind"],
    title: r.title,
    url: r.url ?? undefined,
    ingested_at: r.ingested_at,
    raw_excerpt: r.raw_excerpt,
    source_prior: r.source_prior,
  }));
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
