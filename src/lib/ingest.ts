// path: src/lib/ingest.ts
import type { Fact, Source } from "./types";
import { extract } from "./extractor";
import {
  closeKnownTo,
  getAllFactsForEntity,
  ident,
  insertFact,
  insertSource,
  logEvent,
  newFactId,
  newSourceId,
} from "./db";
import { groupByOverlap, computePosterior } from "./reconciler";
import { emitEvent } from "./events";
import { normalizePredicate } from "./normalize";
import { judgeRelevance, type RelevanceDecision } from "./relevance";

export type IngestInput = {
  entity: string;
  source: {
    kind: Source["kind"];
    title: string;
    raw_excerpt: string;
    source_prior?: number;
  };
};

export type IngestResult = {
  source: Source;
  facts: Fact[];
  inserted: number;
  superseded: number;
  conflicts: Array<{ predicate: string; posterior: { value: string; probability: number }[] }>;
  normalized: Array<{ raw: string; canonical: string }>; // schema-alignment evidence
  relevance: RelevanceDecision;                          // signal/noise decision
  latency_ms: number;
};

export async function ingest(input: IngestInput): Promise<IngestResult> {
  const t0 = performance.now();
  const now = new Date().toISOString();

  const source: Source = {
    id: newSourceId(input.source.title),
    kind: input.source.kind,
    title: input.source.title,
    ingested_at: now,
    raw_excerpt: input.source.raw_excerpt,
    source_prior: input.source.source_prior ?? 0.8,
  };
  insertSource(source);
  emitEvent({ kind: "source.ingested", source_id: source.id, title: source.title });

  const extracted = await extract(input.entity, source);
  emitEvent({ kind: "extractor.completed", source_id: source.id, fact_count: extracted.length });

  // ── Signal / noise gate (Buena §3) ───────────────────────────────────
  const relevance = judgeRelevance(input.entity, source, extracted.length);
  if (!relevance.accept) {
    emitEvent({
      kind: "relevance.rejected",
      source_id: source.id,
      score: relevance.score,
      reasons: relevance.reasons,
    });
    const latency_ms = Math.round(performance.now() - t0);
    return {
      source,
      facts: [],
      inserted: 0,
      superseded: 0,
      conflicts: [],
      normalized: [],
      relevance,
      latency_ms,
    };
  }

  // ── Schema alignment (Buena §1) ──────────────────────────────────────
  // Normalize predicate names BEFORE storing, so facts with different source
  // vocabularies (Eigentümer / Owner / MietEig / Kontakt) collapse to the
  // same canonical predicate and can conflict/merge correctly downstream.
  const normalizationLog: Array<{ raw: string; canonical: string }> = [];
  for (const ef of extracted) {
    const n = normalizePredicate(ef.predicate);
    if (n.aliased_from) {
      normalizationLog.push({ raw: n.aliased_from, canonical: n.canonical });
      ef.predicate = n.canonical;
    }
  }

  const writtenFacts: Fact[] = [];
  let superseded = 0;
  const conflictsOut: IngestResult["conflicts"] = [];

  const existing = getAllFactsForEntity(input.entity).filter((f) => f.known_to === null);
  const byPred = new Map<string, Fact[]>();
  for (const f of existing) {
    const list = byPred.get(f.predicate) ?? [];
    list.push(f);
    byPred.set(f.predicate, list);
  }

  for (const ef of extracted) {
    const id = newFactId();
    const fact: Fact = {
      id,
      entity: input.entity,
      predicate: ef.predicate,
      value: ef.value,
      unit: ef.unit,
      valid_from: ef.valid_from ?? null,
      valid_to: ef.valid_to ?? null,
      known_from: now,
      known_to: null,
      source: source.id,
      span: ef.span,
      confidence: ef.confidence,
      superseded_by: null,
      ident: ident(input.entity, ef.predicate, ef.valid_from ?? null),
    };
    insertFact(fact);
    logEvent("insert", id, `${ef.predicate}=${ef.value}`);
    writtenFacts.push(fact);

    const sameKey = byPred.get(ef.predicate) ?? [];
    const overlapping = sameKey.filter((e) =>
      validIntervalsOverlap(e, fact),
    );

    if (overlapping.length > 0) {
      // Partition overlaps by value: same-value facts are superseded,
      // different-value facts remain in conflict with the new fact.
      const sameValueOld = overlapping.filter((e) => String(e.value) === String(fact.value));
      const differentValueOld = overlapping.filter((e) => String(e.value) !== String(fact.value));

      // Supersede ONLY same-value prior facts (same claim, newer source)
      for (const old of sameValueOld) {
        closeKnownTo(old.id, now);
        logEvent("supersede", old.id, `replaced by ${id}`);
        superseded++;
      }

      // If there are still different-value overlaps, this is a conflict
      if (differentValueOld.length > 0) {
        const posterior = computePosterior([...differentValueOld, fact], ef.predicate);
        logEvent("conflict-detected", id, `pred=${ef.predicate}`);
        emitEvent({
          kind: "conflict.detected",
          predicate: ef.predicate,
          posterior: posterior.entries.map((e) => ({ value: e.value, probability: e.probability })),
        });
        conflictsOut.push({
          predicate: ef.predicate,
          posterior: posterior.entries.map((e) => ({ value: e.value, probability: e.probability })),
        });
      }
    }

    emitEvent({
      kind: "fact.inserted",
      fact_id: id,
      predicate: ef.predicate,
      value: String(ef.value),
    });
  }

  const latency_ms = Math.round(performance.now() - t0);
  emitEvent({ kind: "render.completed", entity: input.entity, fact_count: writtenFacts.length, latency_ms });

  return {
    source,
    facts: writtenFacts,
    inserted: writtenFacts.length,
    superseded,
    conflicts: conflictsOut,
    normalized: normalizationLog,
    relevance,
    latency_ms,
  };
}

function validIntervalsOverlap(a: Fact, b: Fact): boolean {
  const aStart = a.valid_from ?? "0000-01-01";
  const aEnd = a.valid_to ?? "9999-12-31";
  const bStart = b.valid_from ?? "0000-01-01";
  const bEnd = b.valid_to ?? "9999-12-31";
  return !(aEnd < bStart || bEnd < aStart);
}

// Helper retained for reconciler grouping elsewhere
export { groupByOverlap };
