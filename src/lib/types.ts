// path: src/lib/types.ts
/**
 * Hausbuch core types. See REBUILD.md §4 for the design rationale.
 *
 * Key ideas:
 *  - Facts are append-only. Every change writes a new row.
 *  - Bitemporality: (valid_from, valid_to) and (known_from, known_to) on each fact.
 *  - Citations carry a text-span "quote" so the proof-lens UI can render verbatim.
 *  - Confidence is per-source; the reconciler merges into a posterior at conflict time.
 */

export type EntityId = string; // e.g. "weg:immanuelkirchstr-26", "unit:EH-001"
export type SourceId = string; // e.g. "src:land-registry"
export type FactId = string; // uuid

/**
 * Maximum bytes of extracted text we feed into the fact extractor and store as
 * raw_excerpt on a Source. Bumped from 8 KB → 128 KB to handle the long
 * design / inspection / building reports the engine routinely sees (≈50+
 * pages of typical text per document). Cost in the extractor scales linearly
 * with this value — keep it shared so a single edit re-tunes every code path
 * (upload, upload-bulk, commit, route-doc probe, seed).
 */
export const RAW_EXCERPT_BYTES = 131072;

// ── Entity types (WEG hierarchy) ────────────────────────────────────────────

export type EntityType = "weg" | "building" | "unit" | "owner" | "tenant" | "contractor";

export type Entity = {
  id: EntityId;
  type: EntityType;
  name: string;
  parent_id?: string | null;
  meta?: Record<string, unknown>;
  created_at: string;
};

// ── Source kinds ─────────────────────────────────────────────────────────────

export type SourceKind =
  | "email"
  | "pdf"
  | "slack"
  | "erp"
  | "note"
  | "db"
  | "legal"
  | "zendesk"
  /** Text was extracted from an image or scanned PDF via Gemini vision (FR-24). */
  | "image-ocr"
  /** Live enrichment fetched from Tavily (FR-25). */
  | "tavily"
  /** Live enrichment fetched from Cala (entity verification). */
  | "cala"
  /** Bank transaction (Kontoauszug). */
  | "bank"
  /** Contractor invoice (Rechnung). */
  | "invoice"
  /** Formal letter (Brief — Hausgeld, Kündigung, etc.). */
  | "letter"
  /** Master data import (Stammdaten). */
  | "stammdaten"
  /** Freeform user knowledge input. */
  | "user-input";

export type Source = {
  id: SourceId;
  kind: SourceKind;
  title: string;
  url?: string;
  ingested_at: string; // ISO
  raw_excerpt: string;
  /** Prior reliability 0..1 — used in Dawid-Skene posterior. */
  source_prior: number;
  /** Entity this source primarily relates to. */
  entity_id?: string;
  /** Email thread ID for conversation tracking. */
  thread_id?: string;
  /** Email category (e.g. "mieter/schaden", "eigentuemer/rechtlich"). */
  category?: string;
  /** Email direction: incoming or outgoing. */
  direction?: "incoming" | "outgoing";
  /** Sender address for emails. */
  from_addr?: string;
  /** Recipient address for emails. */
  to_addr?: string;
};

export type FactValue = string | number | boolean | null;

export type FactSpan = {
  start: number;
  end: number;
  quote: string;
};

export type Fact = {
  id: FactId;
  entity: EntityId;
  predicate: string; // snake_case, dotted keys allowed
  value: FactValue;
  unit?: string;
  /** valid_time interval — when the claim is true in the world. */
  valid_from?: string | null;
  valid_to?: string | null;
  /** known_time interval — when Hausbuch believed it. */
  known_from: string;
  known_to: string | null;
  source: SourceId;
  span: FactSpan;
  /** Per-source confidence 0..1 from the extractor. */
  confidence: number;
  /** If this fact was replaced, points at the successor. */
  superseded_by?: FactId | null;
  /** Identity key: hash(entity + predicate + valid_from). */
  ident: string;
};

export type FactEventKind =
  | "insert"
  | "supersede"
  | "conflict-detected"
  | "resolve"
  | "revoke";

export type FactEvent = {
  id: number;
  at: string; // ISO — monotonic
  kind: FactEventKind;
  fact_id: FactId;
  note?: string;
};

/** Detail level 1..5 controls how much of Context.md is rendered. */
export type Detail = 1 | 2 | 3 | 4 | 5;

export type BitemporalPoint = {
  at_valid?: string; // default: now
  at_known?: string; // default: now
};

export type RenderOptions = BitemporalPoint & {
  detail?: Detail;
};

/** Dawid-Skene-style posterior over competing values for the same predicate. */
export type Posterior = {
  predicate: string;
  entries: Array<{
    fact_id: FactId;
    value: string;
    probability: number;
  }>;
  method: "dawid-skene-1979";
};

/** A rendered current view of a predicate. */
export type PredicateView =
  | {
      kind: "single";
      fact: Fact;
    }
  | {
      kind: "conflict";
      facts: Fact[];
      posterior: Posterior;
    };
