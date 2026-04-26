// path: src/lib/query.ts
import type { BitemporalPoint, Fact, PredicateView } from "./types";
import { getAllFactsForEntity } from "./db";
import { computePosterior, groupByOverlap } from "./reconciler";

/**
 * Decide whether a group of facts under one predicate is a real conflict or
 * just corroboration (same value asserted by multiple sources).
 *
 * Without this, three sources all reporting "true" rendered as a "conflict"
 * with P=1.00 — confusing the user, since the system was telling them three
 * agreeing observations were a disagreement. Real conflict requires distinct
 * values across the group; otherwise return the most-recent fact as a single
 * (the renderer's existing countCorroborations() will then surface the
 * "× N sources" badge for free).
 */
function classifyGroup(group: Fact[], predicate: string): PredicateView {
  if (group.length === 1) return { kind: "single", fact: group[0] };
  const values = new Set(group.map((f) => normalizeValue(f.value)));
  if (values.size === 1) {
    // All sources agree on the same value — corroboration, not conflict.
    // Pick the most recent fact so the citation in the rendered line points
    // at the freshest evidence (countCorroborations handles the multi-source
    // badge separately).
    const latest = [...group].sort((a, b) =>
      (b.known_from ?? "").localeCompare(a.known_from ?? ""),
    )[0];
    return { kind: "single", fact: latest };
  }
  return {
    kind: "conflict",
    facts: group,
    posterior: computePosterior(group, predicate),
  };
}

function normalizeValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    // 1500 vs 1500.0 vs "1500" should all collapse so a numeric corroboration
    // doesn't render as a conflict because of formatting drift between sources.
    return String(Number(v));
  }
  return String(v).trim().toLowerCase();
}

/**
 * Project the append-only fact store into a bitemporal view.
 *
 * For a given entity and (at_valid, at_known):
 *   1. Filter facts to those "known" at `at_known`
 *      (known_from <= at_known AND (known_to IS NULL OR known_to > at_known))
 *   2. Filter further to those "valid" at `at_valid`
 *      (valid_from IS NULL OR valid_from <= at_valid)
 *      (valid_to IS NULL OR valid_to > at_valid)
 *   3. Group by predicate; within each predicate, group by overlapping valid-range.
 *      - singleton → single PredicateView
 *      - multiple  → conflict PredicateView with Dawid-Skene posterior
 *   4. When multiple facts for the same predicate have non-overlapping valid ranges
 *      AND only one is currently active at (at_valid), pick it. We surface the current
 *      one to the renderer.
 */
export type ViewResult = {
  current: Record<string, PredicateView>;
  upcoming: Record<string, PredicateView>;
};

export function currentView(
  entity: string,
  point: BitemporalPoint = {},
): Record<string, PredicateView> {
  return fullView(entity, point).current;
}

/**
 * Full projection at a bitemporal point: both the currently-true predicates AND
 * the known-but-not-yet-valid predicates (upcoming changes).
 */
export function fullView(
  entity: string,
  point: BitemporalPoint = {},
): ViewResult {
  const atValid = point.at_valid ?? new Date().toISOString();
  const atKnown = point.at_known ?? new Date().toISOString();

  const all = getAllFactsForEntity(entity);

  const knownNow = all.filter((f) => {
    const kfOk = f.known_from <= atKnown;
    const ktOk = f.known_to === null || f.known_to > atKnown;
    return kfOk && ktOk;
  });

  // For each predicate, find overlap groups at at_valid
  const byPredicate = new Map<string, Fact[]>();
  for (const f of knownNow) {
    const list = byPredicate.get(f.predicate) ?? [];
    list.push(f);
    byPredicate.set(f.predicate, list);
  }

  const current: Record<string, PredicateView> = {};
  const upcoming: Record<string, PredicateView> = {};

  for (const [predicate, facts] of byPredicate) {
    const currentGroup = facts.filter((f) => {
      const vfOk = !f.valid_from || f.valid_from <= atValid;
      const vtOk = !f.valid_to || f.valid_to > atValid;
      return vfOk && vtOk;
    });

    if (currentGroup.length > 0) {
      const groups = groupByOverlap(currentGroup);
      const group = groups[0];
      if (group) {
        current[predicate] = classifyGroup(group, predicate);
      }
    }

    // Upcoming: valid_from > atValid
    const upcomingGroup = facts.filter(
      (f) => f.valid_from && f.valid_from > atValid,
    );
    if (upcomingGroup.length > 0) {
      // Pick the EARLIEST upcoming valid range and group facts that share it
      upcomingGroup.sort((a, b) => (a.valid_from! < b.valid_from! ? -1 : 1));
      const earliest = upcomingGroup[0].valid_from;
      const earliestBucket = upcomingGroup.filter((f) => f.valid_from === earliest);
      upcoming[predicate] = classifyGroup(earliestBucket, predicate);
    }
  }

  return { current, upcoming };
}

export type BitemporalQuery = BitemporalPoint & {
  entity: string;
};
