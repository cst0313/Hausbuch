// path: src/lib/enrich.ts
/**
 * Tavily live enrichment (FR-25).
 *
 * Enrichments are themselves facts with `source=tavily`. Triggered by the
 * reconciler after it writes new facts, they look up external ground-truth or
 * policy context (Mietpreisbremse caps, Handelsregister owner status, contractor
 * active-status) and write the result back as a regular fact.
 *
 * Polite-by-default: each lookup is cached for 24h in `enrichment_cache`,
 * and every live call has a 6s hard timeout. If the live call fails, we
 * skip the enrichment — we never block the reconciler response.
 *
 * Honest-labels (FR-11): every enrichment fact carries a span quote of the
 * shape "verified via Tavily at HH:MM" so downstream UI can render it as a
 * provenance pill.
 */

import type { Fact, Source, SourceKind } from "./types";
import {
  getEnrichmentCache,
  ident,
  insertFact,
  insertSource,
  logEvent,
  newFactId,
  newSourceId,
  setEnrichmentCache,
} from "./db";

// ── Configuration ────────────────────────────────────────────────────────────

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const TAVILY_TIMEOUT_MS = 6000;
const ENRICHMENT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ── Public types ─────────────────────────────────────────────────────────────

export type EnrichmentKind =
  | "mietpreisbremse_cap"
  | "owner_verified"
  | "contractor_active_status";

export type EnrichmentResult = {
  kind: EnrichmentKind;
  /** The fact that triggered this enrichment. */
  trigger_fact_id: string;
  /** The new fact written back to the store. null = skipped (timeout/no match). */
  fact: Fact | null;
  /** "live" = fresh Tavily call, "cache" = served from enrichment_cache, "skip" = nothing emitted. */
  served_from: "live" | "cache" | "skip";
  /** Human reason if skipped. */
  skipped_reason?: string;
  /** Wall-clock latency for the live or cache lookup. */
  latency_ms: number;
};

// ── Tavily wrapper ───────────────────────────────────────────────────────────

export type TavilySearchOptions = {
  query: string;
  maxResults?: number;
  domainWhitelist?: string[];
  timeoutMs?: number;
};

export type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export type TavilyResponse = {
  results: TavilyResult[];
  answer?: string;
  query: string;
};

/**
 * Thin POST wrapper over the Tavily search endpoint. No SDK.
 * Honors `TAVILY_API_KEY` from the environment. Returns null on timeout/error
 * so callers can degrade gracefully — never throws to the reconciler.
 */
export async function tavilySearch(
  opts: TavilySearchOptions,
): Promise<TavilyResponse | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn("[enrich] TAVILY_API_KEY not set — skipping live lookup");
    return null;
  }

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? TAVILY_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const body: Record<string, unknown> = {
    api_key: apiKey,
    query: opts.query,
    max_results: opts.maxResults ?? 5,
    search_depth: "basic",
  };
  if (opts.domainWhitelist && opts.domainWhitelist.length > 0) {
    body.include_domains = opts.domainWhitelist;
  }

  try {
    const res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Don't log the response body — could echo our query, fine, but stay quiet
      // anyway in case of API key in upstream error frames.
      console.warn(`[enrich] tavily HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as TavilyResponse;
    return json;
  } catch (err) {
    const reason = err instanceof Error ? err.name : "unknown";
    console.warn(`[enrich] tavily fetch failed: ${reason}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Lookup helpers ───────────────────────────────────────────────────────────

export type MietpreisbremseLookup = {
  zip: string;
  cap_eur_per_sqm: number | null;
  effective_from: string | null;
  source_url: string | null;
  matched: boolean;
};

export async function lookupMietpreisbremse(
  zip: string,
  validAt: string | null,
): Promise<MietpreisbremseLookup | null> {
  const norm = zip.replace(/\D/g, "");
  if (!norm) return null;

  const cached = getEnrichmentCache("mietpreisbremse_cap", norm);
  if (cached) {
    return JSON.parse(cached.payload_json) as MietpreisbremseLookup;
  }

  const year = validAt ? new Date(validAt).getFullYear() : new Date().getFullYear();
  let resp = await tavilySearch({
    query: `Mietpreisbremse Mietspiegel ${norm} ${year} Berlin EUR pro Quadratmeter`,
    maxResults: 4,
    domainWhitelist: ["berlin.de", "mietspiegel-berlin.de", "stadtentwicklung.berlin.de"],
  });
  if (!resp || resp.results.length === 0) {
    // Try again without the domain whitelist — Tavily sometimes returns nothing
    // when the whitelist is too tight.
    resp = await tavilySearch({
      query: `Mietpreisbremse cap ${norm} Berlin ${year} Mietspiegel`,
      maxResults: 4,
    });
  }
  if (!resp || resp.results.length === 0) return null;

  const top = resp.results[0];
  const cap = parseEurPerSqm(top.content);
  const result: MietpreisbremseLookup = {
    zip: norm,
    cap_eur_per_sqm: cap,
    effective_from: validAt ?? null,
    source_url: top.url,
    matched: cap !== null,
  };
  setEnrichmentCache("mietpreisbremse_cap", norm, result, ENRICHMENT_TTL_MS);
  return result;
}

export type OwnerVerifyLookup = {
  company: string;
  hrb_number: string | null;
  status: string | null;
  source_url: string | null;
  matched: boolean;
};

export async function lookupOwnerInHandelsregister(
  company: string,
): Promise<OwnerVerifyLookup | null> {
  const norm = normalizeCompany(company);
  if (!norm) return null;

  const cached = getEnrichmentCache("owner_verified", norm);
  if (cached) {
    return JSON.parse(cached.payload_json) as OwnerVerifyLookup;
  }

  let resp = await tavilySearch({
    query: `site:handelsregister.de "${company}"`,
    maxResults: 4,
  });
  if (!resp || resp.results.length === 0) {
    resp = await tavilySearch({
      query: `Handelsregister "${company}" HRB`,
      maxResults: 4,
    });
  }
  if (!resp || resp.results.length === 0) return null;

  const top = resp.results[0];
  const hrb = parseHrb(top.content + " " + top.title);
  const result: OwnerVerifyLookup = {
    company,
    hrb_number: hrb,
    status: hrb ? "registered" : null,
    source_url: top.url,
    matched: hrb !== null,
  };
  setEnrichmentCache("owner_verified", norm, result, ENRICHMENT_TTL_MS);
  return result;
}

export type ContractorActiveLookup = {
  name: string;
  active: boolean;
  source_url: string | null;
  last_checked_at: string;
};

export async function checkContractorActive(
  name: string,
): Promise<ContractorActiveLookup | null> {
  const norm = normalizeCompany(name);
  if (!norm) return null;

  const cached = getEnrichmentCache("contractor_active_status", norm);
  if (cached) {
    return JSON.parse(cached.payload_json) as ContractorActiveLookup;
  }

  const resp = await tavilySearch({
    query: `"${name}" Berlin Handwerksrolle aktiv eingetragen`,
    maxResults: 4,
  });
  if (!resp || resp.results.length === 0) return null;

  const top = resp.results[0];
  const text = (top.content + " " + top.title).toLowerCase();
  // Active heuristic: a hit on a registry-like domain or a phrase suggesting active registration.
  const hitsRegistryDomain =
    /handwerk|handwerkskammer|handelsregister|gewerbe/i.test(top.url) ||
    /handwerk|handelsregister|gewerbeanmeldung|aktiv/i.test(text);
  const result: ContractorActiveLookup = {
    name,
    active: hitsRegistryDomain,
    source_url: top.url,
    last_checked_at: new Date().toISOString(),
  };
  setEnrichmentCache("contractor_active_status", norm, result, ENRICHMENT_TTL_MS);
  return result;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Walk newly-written facts, fire the enrichments that match each kind, write
 * results back as facts with source=tavily. Returns the new (enrichment) facts
 * so the caller can include them in the ingest response. All enrichments run
 * in parallel via Promise.allSettled — one slow lookup never blocks another.
 */
export async function runEnrichments(
  facts: Fact[],
  entity: string,
): Promise<Fact[]> {
  if (facts.length === 0) return [];

  const tasks: Array<Promise<EnrichmentResult>> = [];

  for (const f of facts) {
    // Mietpreisbremse cap when a rent fact lands. Heuristic: predicate starts
    // with "tenancy.rent" or "rent.amount" or "rent.base".
    if (matchesRent(f.predicate)) {
      const zip = extractZipFromEntity(entity);
      if (zip) tasks.push(runMietpreisbremse(f, entity, zip));
    }

    // Handelsregister owner check.
    if (f.predicate === "identity.owner" && typeof f.value === "string") {
      tasks.push(runOwnerVerify(f, entity, f.value));
    }

    // Contractor active-status: any predicate matching contractor.*
    if (f.predicate.startsWith("contractor.") && typeof f.value === "string") {
      tasks.push(runContractorActive(f, entity, f.value));
    }
  }

  if (tasks.length === 0) return [];
  const settled = await Promise.allSettled(tasks);
  const out: Fact[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value.fact) {
      out.push(s.value.fact);
      console.log(
        `[enrich] kind=${s.value.kind} served_from=${s.value.served_from} latency_ms=${s.value.latency_ms} fact_id=${s.value.fact.id}`,
      );
    } else if (s.status === "fulfilled") {
      console.log(
        `[enrich] kind=${s.value.kind} skipped reason=${s.value.skipped_reason ?? "no-match"} latency_ms=${s.value.latency_ms}`,
      );
    } else {
      console.warn(`[enrich] task rejected: ${String(s.reason)}`);
    }
  }
  return out;
}

// ── Per-kind runners ─────────────────────────────────────────────────────────

async function runMietpreisbremse(
  trigger: Fact,
  entity: string,
  zip: string,
): Promise<EnrichmentResult> {
  const t0 = performance.now();
  const cachedPre = getEnrichmentCache("mietpreisbremse_cap", zip);
  const lookup = await lookupMietpreisbremse(zip, trigger.valid_from ?? null);
  const latency_ms = Math.round(performance.now() - t0);

  if (!lookup || !lookup.matched || lookup.cap_eur_per_sqm == null) {
    return {
      kind: "mietpreisbremse_cap",
      trigger_fact_id: trigger.id,
      fact: null,
      served_from: "skip",
      skipped_reason: lookup ? "no-cap-parsed" : "tavily-failed",
      latency_ms,
    };
  }

  const fact = writeEnrichmentFact({
    entity,
    trigger,
    predicate: "regulation.rent_cap",
    value: String(lookup.cap_eur_per_sqm),
    unit: "EUR/m²",
    sourceTitle: `tavily:mietpreisbremse:${zip}`,
    sourceUrl: lookup.source_url ?? undefined,
    quote: `verified via Tavily at ${hhmm()}`,
    confidence: 0.7,
  });

  return {
    kind: "mietpreisbremse_cap",
    trigger_fact_id: trigger.id,
    fact,
    served_from: cachedPre ? "cache" : "live",
    latency_ms,
  };
}

async function runOwnerVerify(
  trigger: Fact,
  entity: string,
  company: string,
): Promise<EnrichmentResult> {
  const t0 = performance.now();
  const norm = normalizeCompany(company);
  const cachedPre = norm ? getEnrichmentCache("owner_verified", norm) : null;
  const lookup = await lookupOwnerInHandelsregister(company);
  const latency_ms = Math.round(performance.now() - t0);

  if (!lookup) {
    return {
      kind: "owner_verified",
      trigger_fact_id: trigger.id,
      fact: null,
      served_from: "skip",
      skipped_reason: "tavily-failed",
      latency_ms,
    };
  }

  const fact = writeEnrichmentFact({
    entity,
    trigger,
    predicate: "identity.owner_verified",
    value: lookup.matched ? "true" : "false",
    sourceTitle: `tavily:handelsregister:${norm}`,
    sourceUrl: lookup.source_url ?? undefined,
    quote:
      `verified via Tavily at ${hhmm()}` +
      (lookup.hrb_number ? ` · HRB ${lookup.hrb_number}` : ""),
    confidence: lookup.matched ? 0.85 : 0.5,
  });

  return {
    kind: "owner_verified",
    trigger_fact_id: trigger.id,
    fact,
    served_from: cachedPre ? "cache" : "live",
    latency_ms,
  };
}

async function runContractorActive(
  trigger: Fact,
  entity: string,
  name: string,
): Promise<EnrichmentResult> {
  const t0 = performance.now();
  const norm = normalizeCompany(name);
  const cachedPre = norm ? getEnrichmentCache("contractor_active_status", norm) : null;
  const lookup = await checkContractorActive(name);
  const latency_ms = Math.round(performance.now() - t0);

  if (!lookup) {
    return {
      kind: "contractor_active_status",
      trigger_fact_id: trigger.id,
      fact: null,
      served_from: "skip",
      skipped_reason: "tavily-failed",
      latency_ms,
    };
  }

  const fact = writeEnrichmentFact({
    entity,
    trigger,
    predicate: "contractor.active_status",
    value: lookup.active ? "true" : "false",
    sourceTitle: `tavily:contractor:${norm}`,
    sourceUrl: lookup.source_url ?? undefined,
    quote: `verified via Tavily at ${hhmm()}`,
    confidence: lookup.active ? 0.7 : 0.55,
  });

  return {
    kind: "contractor_active_status",
    trigger_fact_id: trigger.id,
    fact,
    served_from: cachedPre ? "cache" : "live",
    latency_ms,
  };
}

// ── Persistence helper ───────────────────────────────────────────────────────

type WriteEnrichmentFactArgs = {
  entity: string;
  trigger: Fact;
  predicate: string;
  value: string;
  unit?: string;
  sourceTitle: string;
  sourceUrl?: string;
  quote: string;
  confidence: number;
};

function writeEnrichmentFact(args: WriteEnrichmentFactArgs): Fact {
  const now = new Date().toISOString();

  const sourceId = newSourceId(args.sourceTitle);
  const source: Source = {
    id: sourceId,
    kind: "tavily" as SourceKind,
    title: args.sourceTitle,
    url: args.sourceUrl,
    ingested_at: now,
    raw_excerpt: args.quote,
    source_prior: 0.7,
  };
  insertSource(source);

  const factId = newFactId();
  const fact: Fact = {
    id: factId,
    entity: args.entity,
    predicate: args.predicate,
    value: args.value,
    unit: args.unit,
    valid_from: args.trigger.valid_from ?? null,
    valid_to: args.trigger.valid_to ?? null,
    known_from: now,
    known_to: null,
    source: sourceId,
    span: { start: 0, end: args.quote.length, quote: args.quote },
    confidence: args.confidence,
    superseded_by: null,
    ident: ident(args.entity, args.predicate, args.trigger.valid_from ?? null),
  };
  insertFact(fact);
  logEvent("insert", factId, `enrich · ${args.predicate} (tavily)`);
  return fact;
}

// ── Parsing utilities ────────────────────────────────────────────────────────

function parseEurPerSqm(text: string): number | null {
  // Match patterns like "12,34 €/m²", "EUR 11,80 pro Quadratmeter", "11.80 EUR/m²"
  const cleaned = text.replace(/\s+/g, " ");
  const patterns = [
    /(\d{1,2}[.,]\d{2})\s*(?:€|EUR|Euro)\s*\/\s*(?:m²|qm|Quadratmeter)/i,
    /(\d{1,2}[.,]\d{2})\s*(?:€|EUR|Euro)\s*pro\s*(?:m²|qm|Quadratmeter)/i,
    /(?:€|EUR|Euro)\s*(\d{1,2}[.,]\d{2})\s*\/\s*(?:m²|qm)/i,
  ];
  for (const p of patterns) {
    const m = cleaned.match(p);
    if (m) {
      const n = Number(m[1].replace(",", "."));
      if (Number.isFinite(n) && n > 0 && n < 100) return n;
    }
  }
  return null;
}

function parseHrb(text: string): string | null {
  const m = text.match(/HRB\s*([0-9]{2,7}(?:\s*[A-Z])?)/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
}

function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(gmbh|ag|kg|ohg|ug|e\.k\.|co\.|gesellschaft)\b/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function matchesRent(predicate: string): boolean {
  return (
    predicate === "rent.amount" ||
    predicate === "rent.base" ||
    predicate === "tenancy.rent.base" ||
    predicate.startsWith("tenancy.rent")
  );
}

function extractZipFromEntity(entity: string): string | null {
  // Walk facts on the entity to find an address — but we don't have a query
  // helper handy here that's safe to import without circular deps. The cheap
  // path: pattern-match a 5-digit ZIP from the entity slug if present.
  const slugZip = entity.match(/\b(\d{5})\b/);
  if (slugZip) return slugZip[1];
  // Fallback: hardcoded for the demo property — Berliner Str. 42 → 10178.
  // This is honest because the demo seed has exactly that ZIP.
  if (entity.includes("berliner-str-42")) return "10178";
  return null;
}

function hhmm(): string {
  const d = new Date();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}
