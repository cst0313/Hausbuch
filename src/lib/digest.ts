// path: src/lib/digest.ts
/**
 * Inbox digest helpers. Query the fact store for "what changed" per entity,
 * sliced by known-time (when we learned it), not valid-time (when it's true).
 *
 * The bitemporal model means these are all just filters over the existing
 * fact table. No new storage.
 */
import { getAllFactsForEntity, listSources } from "./db";
import { fullView } from "./query";
import type { Fact, Source } from "./types";

export type DigestItem = {
  fact: Fact;
  source: Source | null;
  kind: "added" | "superseded" | "conflict";
  partnerPredicate?: string; // for conflict: the other side
};

export type Digest = {
  entity: string;
  since: string; // ISO — lower bound of known_from we filtered by
  new: DigestItem[];
  decide: DigestItem[];
  changed: DigestItem[];
};

/**
 * Compute a digest for one entity.
 *
 * - `new`:      facts newly known since `since`, still active (known_to is null)
 * - `changed`:  facts superseded since `since` (i.e. known_to > since, or the
 *               superseding fact was added since `since`)
 * - `decide`:   predicates where the current view is a conflict (posterior over
 *               competing values). Only those ALSO touched since `since` to
 *               avoid re-surfacing old conflicts on every load.
 */
export function digestFor(entity: string, since: string): Digest {
  const allFacts = getAllFactsForEntity(entity);
  const allSources = listSources();
  const sourceById = new Map(allSources.map((s) => [s.id, s]));

  const fresh = allFacts.filter((f) => f.known_from > since);

  // "new": freshly known, not yet superseded
  const newItems: DigestItem[] = fresh
    .filter((f) => !f.superseded_by && f.known_to === null)
    .map((f) => ({
      fact: f,
      source: sourceById.get(f.source) ?? null,
      kind: "added" as const,
    }));

  // "changed": facts that got superseded since `since`, or predicate recently updated
  const changedItems: DigestItem[] = allFacts
    .filter((f) => f.known_to !== null && f.known_to > since)
    .map((f) => ({
      fact: f,
      source: sourceById.get(f.source) ?? null,
      kind: "superseded" as const,
    }));

  // "decide": conflicts in the current bitemporal view that touched a fresh fact
  const view = fullView(entity);
  const freshIdents = new Set(fresh.map((f) => f.ident));
  const decideItems: DigestItem[] = [];
  for (const [, pv] of Object.entries({ ...view.current, ...view.upcoming })) {
    if (pv.kind !== "conflict") continue;
    const touchedFresh = pv.facts.some((f) => freshIdents.has(f.ident));
    if (!touchedFresh) continue;
    // Push the top two candidates as a representative pair
    const top = pv.posterior.entries.slice(0, 2);
    for (const e of top) {
      const f = pv.facts.find((x) => x.id === e.fact_id);
      if (!f) continue;
      decideItems.push({
        fact: f,
        source: sourceById.get(f.source) ?? null,
        kind: "conflict" as const,
        partnerPredicate: top.map((x) => x.value).join(" vs "),
      });
    }
  }

  return {
    entity,
    since,
    new: newItems,
    decide: decideItems,
    changed: changedItems,
  };
}
