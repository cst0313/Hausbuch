// path: src/lib/cala.ts
/**
 * Cala (api.cala.ai) — entity verification + due-diligence partner.
 *
 * Used to verify owner companies and contractor registrations against Cala's
 * knowledge graph. Only the GET /v1/entities endpoint is wired here — that's
 * the cheapest call (1 credit) and gives us enough to flag whether a company
 * is registered and visible in public records.
 *
 * Like Tavily, Cala is a polite-by-default enrichment: 24h cache, 6s timeout,
 * never throws to the reconciler.
 *
 * Env: CALA_API_KEY (X-API-KEY header). When unset, all calls return null and
 * the orchestrator skips the enrichment.
 */

const CALA_BASE = "https://api.cala.ai";
const CALA_TIMEOUT_MS = 6000;

export type CalaEntity = {
  id: string;
  /** Cala uses `entity_type` in the search response, not `type`. */
  entity_type?: "Company" | "Person" | "Organization" | string;
  name: string;
  description?: string;
  /** Fields below appear on the GET /v1/entities/{id} detail call but not the search list. */
  registration_number?: string;
  status?: string;
  jurisdiction?: string;
  source_urls?: string[];
};

export type CalaEntitiesResponse = {
  entities: CalaEntity[];
};

/**
 * Fuzzy entity lookup. Returns null on missing key, timeout, network error,
 * or non-2xx — never throws.
 */
export async function calaSearchEntities(
  name: string,
  type?: "Company" | "Person" | "Organization",
): Promise<CalaEntity[] | null> {
  const apiKey = process.env.CALA_API_KEY;
  if (!apiKey) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;

  const params = new URLSearchParams({ name: trimmed });
  if (type) params.set("type", type);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALA_TIMEOUT_MS);

  try {
    const res = await fetch(`${CALA_BASE}/v1/entities?${params.toString()}`, {
      method: "GET",
      headers: {
        "X-API-KEY": apiKey,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[cala] entities HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as CalaEntitiesResponse;
    return Array.isArray(json.entities) ? json.entities : [];
  } catch (err) {
    const reason = err instanceof Error ? err.name : "unknown";
    console.warn(`[cala] fetch failed: ${reason}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type CalaEntityCheck = {
  query: string;
  matched: boolean;
  best_match: CalaEntity | null;
  source_url: string | null;
};

/**
 * Best-match wrapper used by the enrichment runner. Picks the highest-quality
 * Cala entity for a given company name.
 */
export async function checkCompanyOnCala(
  company: string,
): Promise<CalaEntityCheck | null> {
  const entities = await calaSearchEntities(company, "Company");
  if (entities === null) return null;
  if (entities.length === 0) {
    return {
      query: company,
      matched: false,
      best_match: null,
      source_url: null,
    };
  }

  // Rank: registration_number > status > name-similarity to the query.
  const qNorm = foldName(company);
  const ranked = [...entities].sort((a, b) => {
    const aReg = a.registration_number ? 1 : 0;
    const bReg = b.registration_number ? 1 : 0;
    if (aReg !== bReg) return bReg - aReg;
    const aSt = a.status ? 1 : 0;
    const bSt = b.status ? 1 : 0;
    if (aSt !== bSt) return bSt - aSt;
    // Substring + token-similarity, both umlaut-folded.
    return nameSimilarity(b.name, qNorm) - nameSimilarity(a.name, qNorm);
  });

  const top = ranked[0];
  return {
    query: company,
    matched: true,
    best_match: top,
    source_url: top.source_urls?.[0] ?? null,
  };
}

/**
 * Normalize a company name: lowercase, fold German umlauts to ASCII pairs
 * (ö→oe, ä→ae, ü→ue, ß→ss), strip non-alphanumerics. Handles cases where
 * the input uses transliterated umlauts and Cala stores the umlaut form.
 */
function foldName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ö/g, "oe")
    .replace(/ä/g, "ae")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameSimilarity(name: string, qNorm: string): number {
  const nNorm = foldName(name);
  if (!nNorm || !qNorm) return 0;

  // Substring bonus: if either contains the other, that's a strong signal.
  const subBonus = nNorm.includes(qNorm) || qNorm.includes(nNorm) ? 0.5 : 0;

  // Token-prefix similarity: each query token contributes up to 1.0 based on
  // the longest prefix it shares with any name token. Captures that "vermoegens"
  // and "vermoegensverwaltung" are partial matches.
  const nTokens = nNorm.split(/\s+/);
  const qTokens = qNorm.split(/\s+/);
  let prefixSum = 0;
  for (const q of qTokens) {
    let best = 0;
    for (const n of nTokens) {
      const len = commonPrefix(q, n);
      if (len > 0) {
        const score = len / Math.max(q.length, n.length);
        if (score > best) best = score;
      }
    }
    prefixSum += best;
  }
  const prefixAvg = qTokens.length > 0 ? prefixSum / qTokens.length : 0;
  return prefixAvg + subBonus;
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
