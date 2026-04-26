// path: src/lib/reconciler.ts
import type { Fact, Posterior } from "./types";
import { getSource } from "./db";

/** 90-day half-life for the recency multiplier — matches reputation.ts */
const RECENCY_HALF_LIFE_DAYS = 90;
/** Bound the recency adjustment so a fresh source can't dominate alone */
const RECENCY_FLOOR = 0.7;
const RECENCY_CEIL = 1.0;

/**
 * Dawid-Skene-flavored conflict reconciliation.
 *
 * Faithful-ish to the 1979 EM approach, but with two practical simplifications:
 *  1. A single EM step (we don't iterate to convergence — usually stable in one pass).
 *  2. Uniform prior over candidate values P(v) = 1/|V|.
 *
 * Improvement (2026-04): when two sources have equal priors and contradict,
 * the older one used to win on extractor-confidence noise alone. We now apply
 * a bounded recency multiplier (90-day half-life, floor 0.7, ceil 1.0) to each
 * fact's effective contribution. The pure prior-weighted Dawid-Skene case is
 * unchanged when sources are roughly contemporaneous; the asymmetry only kicks
 * in when one source is materially older. Measurable on the conflict-category
 * questions in the live benchmark.
 *
 * The intuition (Li 2016 survey):
 *   P(value = v | sources that assert v) ∝ P(v) · Π_{s∈S_v} source_prior[s]
 *                                                    · Π_{s∉S_v} (1 - source_prior[s])
 *
 * We exponentiate the confidence to soften, normalize across candidates, and return
 * a Posterior. The UI renders this inline — no silent winners.
 */
export function computePosterior(
  facts: Fact[],
  predicate: string,
): Posterior {
  if (facts.length === 0) {
    return { predicate, entries: [], method: "dawid-skene-1979" };
  }

  // Group facts by value
  const byValue = new Map<string, Fact[]>();
  for (const f of facts) {
    const key = String(f.value);
    if (!byValue.has(key)) byValue.set(key, []);
    byValue.get(key)!.push(f);
  }

  const values = Array.from(byValue.keys());
  const uniformPrior = 1 / values.length;

  // All sources involved in any claim
  const allSourceIds = Array.from(new Set(facts.map((f) => f.source)));
  const priors = new Map<string, number>();
  for (const id of allSourceIds) {
    const s = getSource(id);
    priors.set(id, s?.source_prior ?? 0.7);
  }

  // Unnormalized likelihoods
  const rawLikelihood: Record<string, number> = {};
  for (const v of values) {
    const assertingSources = new Set(byValue.get(v)!.map((f) => f.source));
    let logL = Math.log(uniformPrior);
    for (const sid of allSourceIds) {
      const p = priors.get(sid)!;
      if (assertingSources.has(sid)) {
        // Weight by extractor confidence for the specific fact, plus a
        // bounded recency multiplier so older claims don't dominate
        // contemporary ones on prior alone.
        const fact = byValue.get(v)!.find((f) => f.source === sid)!;
        const recency = recencyWeight(fact);
        logL += Math.log(p * fact.confidence * recency);
      } else {
        // This source did NOT assert v — small evidence against
        logL += Math.log((1 - p) + 1e-6);
      }
    }
    rawLikelihood[v] = Math.exp(logL);
  }

  const total = Object.values(rawLikelihood).reduce((a, b) => a + b, 0) || 1;
  const entries = values.map((v) => {
    const factsForV = byValue.get(v)!;
    const representative = factsForV[0];
    return {
      fact_id: representative.id,
      value: v,
      probability: rawLikelihood[v] / total,
    };
  });

  // Sort descending by probability
  entries.sort((a, b) => b.probability - a.probability);
  return { predicate, entries, method: "dawid-skene-1979" };
}

/**
 * Given a pool of currently-known facts for the same (entity, predicate),
 * group them by overlapping valid-time range and mark each group as:
 *  - "single": one fact dominant (others superseded)
 *  - "conflict": multiple facts with different values for the same valid range
 */
export function groupByOverlap(facts: Fact[]): Fact[][] {
  if (facts.length === 0) return [];
  const sorted = [...facts].sort((a, b) => {
    const av = a.valid_from ?? "";
    const bv = b.valid_from ?? "";
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
  const groups: Fact[][] = [];
  for (const f of sorted) {
    const last = groups[groups.length - 1];
    if (last && validOverlap(last[last.length - 1], f)) {
      last.push(f);
    } else {
      groups.push([f]);
    }
  }
  return groups;
}

/**
 * Bounded multiplier in [RECENCY_FLOOR, RECENCY_CEIL]. A fact known today
 * gets 1.0; a 90-day-old fact gets ~0.85; very old facts asymptote to the
 * floor. Keeps the reconciler's preference for newer claims explicit rather
 * than baked into priors.
 */
function recencyWeight(fact: Fact): number {
  const knownAt = fact.known_from ? new Date(fact.known_from).getTime() : Date.now();
  const ageDays = Math.max(0, (Date.now() - knownAt) / 86_400_000);
  const decayed = Math.exp(-(Math.LN2 * ageDays) / RECENCY_HALF_LIFE_DAYS);
  return RECENCY_FLOOR + (RECENCY_CEIL - RECENCY_FLOOR) * decayed;
}

function validOverlap(a: Fact, b: Fact): boolean {
  // Use ISO-sortable sentinels so string comparison works correctly with
  // "YYYY-MM-DD" dates. "+inf" < "2019-01-01" lexicographically breaks overlap.
  const aStart = a.valid_from ?? "0000-01-01";
  const aEnd = a.valid_to ?? "9999-12-31";
  const bStart = b.valid_from ?? "0000-01-01";
  const bEnd = b.valid_to ?? "9999-12-31";
  return !(aEnd < bStart || bEnd < aStart);
}
