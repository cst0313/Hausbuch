// path: src/lib/events.ts
/**
 * In-process pub/sub for SSE streams.
 *
 * For a production deployment you'd swap this for Redis or a queue — here we keep it
 * simple so the dev server works out of the box with no external dependencies.
 */

export type LumenEvent =
  | { kind: "source.ingested"; source_id: string; title: string }
  | { kind: "extractor.completed"; source_id: string; fact_count: number }
  | { kind: "fact.inserted"; fact_id: string; predicate: string; value: string }
  | {
      kind: "conflict.detected";
      predicate: string;
      posterior: Array<{ value: string; probability: number }>;
    }
  | { kind: "render.completed"; entity: string; fact_count: number; latency_ms: number }
  | { kind: "relevance.rejected"; source_id: string; score: number; reasons: string[] }
  | { kind: "schema.normalized"; raw: string; canonical: string };

type Subscriber = (e: LumenEvent & { at: string }) => void;

const subscribers = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function emitEvent(e: LumenEvent): void {
  const stamped = { ...e, at: new Date().toISOString() };
  for (const fn of subscribers) {
    try {
      fn(stamped);
    } catch (err) {
      console.error("[hausbuch] subscriber failed:", err);
    }
  }
}
