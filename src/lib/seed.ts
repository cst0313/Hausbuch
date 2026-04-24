// path: src/lib/seed.ts
import type Database from "better-sqlite3";
import type { Fact, Source, SourceKind } from "./types";
import { ident, insertSource, insertFact, logEvent, newFactId } from "./db";

/**
 * Baseline seed: six sources with pre-extracted facts that together describe the
 * property at a known-time before the landlord email or the legal memo arrive.
 *
 * Everything above that baseline — the rent-raise email, the legal memo, any
 * judge-provided file — is *ingested live* through POST /api/ingest. That is
 * what makes the demo feel real: the DB grows on stage.
 */

export const ENTITY = "property:berliner-str-42";

const baselineSources: Source[] = [
  {
    id: "src:land-registry",
    kind: "pdf",
    title: "land-registry.pdf",
    ingested_at: "2023-01-10T09:00:00Z",
    raw_excerpt:
      "Grundbuchauszug — Berliner Str. 42, 10178 Berlin. Einheit: 6 Wohneinheiten. Eigentümer seit 2019: Müller Immobilien GmbH (HRB 184321 B).",
    source_prior: 0.98,
  },
  {
    id: "src:erp-buildings",
    kind: "erp",
    title: "erp:buildings#b-4412",
    ingested_at: "2023-01-15T12:00:00Z",
    raw_excerpt:
      'Building asset record b-4412. type: "residential". units: 6. year_built: 1903. last_renovation: 2021-08. floor_area_m2: 512.',
    source_prior: 0.9,
  },
  {
    id: "src:contract-2024",
    kind: "pdf",
    title: "contract-2024.pdf",
    ingested_at: "2024-01-02T10:00:00Z",
    raw_excerpt:
      "Hausverwaltungsvertrag zwischen Müller Immobilien GmbH (nachfolgend „Vermieter\") und Schulz & Partner Hausverwaltung. Gültig ab 2024-01-01.",
    source_prior: 0.92,
  },
  {
    id: "src:lease-2024-03",
    kind: "pdf",
    title: "lease-2024-03.pdf",
    ingested_at: "2024-02-28T14:30:00Z",
    raw_excerpt:
      "Mietvertrag · Wohnung 3, Berliner Str. 42. Mieter: Anna Schmidt (geb. 1989). Mietbeginn: 2024-03-01. Befristet bis: 2027-02-28. Die monatliche Grundmiete beträgt EUR 1.500,00 (in Worten: eintausendfünfhundert). Zuvor: EUR 1.400,00 (2023-01-01 bis 2024-02-29).",
    source_prior: 0.97,
  },
  {
    id: "src:slack-maint",
    kind: "slack",
    title: "slack:#maint msg-8831",
    ingested_at: "2026-02-14T16:45:00Z",
    raw_excerpt:
      "#maint — @oskar (2026-02-14 18:45): Inspection Berliner Str. 42 abgeschlossen. Apt 3: alles in Ordnung. Heizung Apt 5 läuft etwas laut, Ticket erstellt.",
    source_prior: 0.8,
  },
  {
    id: "src:zendesk-t2210",
    kind: "zendesk",
    title: "zendesk:T-2210",
    ingested_at: "2026-02-14T17:10:00Z",
    raw_excerpt:
      "Ticket T-2210 — Heizung Berliner Str. 42, Apt 5. Status: open. Assigned: @oskar. Priority: normal. Description: Nachjustierung Thermostat nötig.",
    source_prior: 0.85,
  },
];

type FactSeed = {
  predicate: string;
  value: string | number | null;
  unit?: string;
  valid_from?: string | null;
  valid_to?: string | null;
  known_from: string;
  source: string;
  span: { start: number; end: number; quote: string };
  confidence: number;
};

const baselineFacts: FactSeed[] = [
  {
    predicate: "identity.address",
    value: "Berliner Str. 42, 10178 Berlin",
    valid_from: "2019-01-01",
    known_from: "2023-01-10T09:00:00Z",
    source: "src:land-registry",
    span: { start: 16, end: 48, quote: "Berliner Str. 42, 10178 Berlin" },
    confidence: 0.99,
  },
  {
    predicate: "identity.type",
    value: "residential",
    valid_from: "2019-01-01",
    known_from: "2023-01-15T12:00:00Z",
    source: "src:erp-buildings",
    span: { start: 30, end: 43, quote: '"residential"' },
    confidence: 0.98,
  },
  {
    predicate: "identity.units",
    value: 6,
    valid_from: "1903-01-01",
    known_from: "2023-01-10T09:00:00Z",
    source: "src:land-registry",
    span: { start: 52, end: 70, quote: "6 Wohneinheiten" },
    confidence: 0.99,
  },
  {
    predicate: "identity.owner",
    value: "Müller Immobilien GmbH",
    valid_from: "2019-01-01",
    known_from: "2023-01-10T09:00:00Z",
    source: "src:land-registry",
    span: { start: 92, end: 114, quote: "Müller Immobilien GmbH" },
    confidence: 0.98,
  },
  {
    predicate: "identity.year_built",
    value: 1903,
    valid_from: "1903-01-01",
    known_from: "2023-01-15T12:00:00Z",
    source: "src:erp-buildings",
    span: { start: 55, end: 71, quote: "year_built: 1903" },
    confidence: 0.95,
  },
  {
    predicate: "identity.floor_area_m2",
    value: 512,
    unit: "m²",
    valid_from: "2021-08-01",
    known_from: "2023-01-15T12:00:00Z",
    source: "src:erp-buildings",
    span: { start: 95, end: 115, quote: "floor_area_m2: 512" },
    confidence: 0.92,
  },
  // Prior rent
  {
    predicate: "tenancy.rent.base",
    value: 1400,
    unit: "EUR/month",
    valid_from: "2023-01-01",
    valid_to: "2024-02-29",
    known_from: "2024-02-28T14:30:00Z",
    source: "src:lease-2024-03",
    span: {
      start: 155,
      end: 214,
      quote: "Zuvor: EUR 1.400,00 (2023-01-01 bis 2024-02-29)",
    },
    confidence: 0.95,
  },
  // Current rent
  {
    predicate: "tenancy.rent.base",
    value: 1500,
    unit: "EUR/month",
    valid_from: "2024-03-01",
    known_from: "2024-02-28T14:30:00Z",
    source: "src:lease-2024-03",
    span: {
      start: 90,
      end: 145,
      quote:
        "Die monatliche Grundmiete beträgt EUR 1.500,00 (in Worten: eintausendfünfhundert)",
    },
    confidence: 0.99,
  },
  {
    predicate: "tenancy.tenant",
    value: "Anna Schmidt",
    valid_from: "2024-03-01",
    known_from: "2024-02-28T14:30:00Z",
    source: "src:lease-2024-03",
    span: { start: 40, end: 70, quote: "Mieter: Anna Schmidt (geb. 1989)" },
    confidence: 0.98,
  },
  {
    predicate: "tenancy.start",
    value: "2024-03-01",
    valid_from: "2024-03-01",
    known_from: "2024-02-28T14:30:00Z",
    source: "src:lease-2024-03",
    span: { start: 70, end: 94, quote: "Mietbeginn: 2024-03-01" },
    confidence: 0.98,
  },
  {
    predicate: "tenancy.end",
    value: "2027-02-28",
    valid_from: "2024-03-01",
    known_from: "2024-02-28T14:30:00Z",
    source: "src:lease-2024-03",
    span: { start: 93, end: 120, quote: "Befristet bis: 2027-02-28" },
    confidence: 0.97,
  },
  {
    predicate: "condition.last_inspection",
    value: "2026-02-14",
    valid_from: "2026-02-14",
    known_from: "2026-02-14T16:45:00Z",
    source: "src:slack-maint",
    span: {
      start: 20,
      end: 75,
      quote: "Inspection Berliner Str. 42 abgeschlossen. Apt 3: alles in Ordnung",
    },
    confidence: 0.9,
  },
  {
    predicate: "condition.open_tickets",
    value: 1,
    valid_from: "2026-02-14",
    known_from: "2026-02-14T17:10:00Z",
    source: "src:zendesk-t2210",
    span: { start: 0, end: 55, quote: "Ticket T-2210 — Heizung Berliner Str. 42, Apt 5" },
    confidence: 0.95,
  },
];

export function seedIfEmpty(database: Database.Database): void {
  const count = database.prepare("SELECT COUNT(*) as n FROM facts").get() as { n: number };
  if (count.n > 0) return;

  const tx = database.transaction(() => {
    for (const s of baselineSources) insertSource(s);
    for (const seed of baselineFacts) {
      const factId = newFactId();
      const fact: Fact = {
        id: factId,
        entity: ENTITY,
        predicate: seed.predicate,
        value: seed.value,
        unit: seed.unit,
        valid_from: seed.valid_from,
        valid_to: seed.valid_to ?? null,
        known_from: seed.known_from,
        known_to: null,
        source: seed.source,
        span: seed.span,
        confidence: seed.confidence,
        superseded_by: null,
        ident: ident(ENTITY, seed.predicate, seed.valid_from),
      };
      insertFact(fact);
      logEvent("insert", factId, `seed · ${seed.predicate}`);
    }
  });
  tx();
}

/* ----------------------------------------------------------------------------
 * Demo scenarios — exactly the sources the /demo page ingests live, in order.
 * The client POSTs these to /api/ingest; the extractor parses them; the
 * reconciler computes the conflict when both arrive. Nothing is pre-recorded
 * in SQLite; the DB actually grows on stage.
 * -------------------------------------------------------------------------- */

export type ScenarioSource = {
  id: string;
  label: string;
  date: string;
  icon: string;
  blurb: string;
  kind: SourceKind;
  title: string;
  raw_excerpt: string;
  source_prior: number;
};

export const DEMO_SCENARIOS: ScenarioSource[] = [
  {
    id: "landlord-email",
    label: "landlord email",
    date: "2026-04-18",
    icon: "✉",
    blurb:
      "Landlord announces rent increase to €1,800 effective 2026-06-01 (source_prior = 0.65)",
    kind: "email",
    title: "email:landlord@müller.de 2026-04-18",
    raw_excerpt:
      "Von: landlord@müller.de. An: verwalter@schulz-hausverwaltung.de. Betreff: Mieterhöhung Apt 3. " +
      "— Ab dem 1. Juni 2026 wird die monatliche Miete auf 1.800 EUR erhöht. " +
      "Mit freundlichen Grüßen, H. Müller.",
    source_prior: 0.65,
  },
  {
    id: "legal-memo",
    label: "legal memo",
    date: "2026-04-22",
    icon: "⚖",
    blurb:
      "Counsel cites §Mietpreisbremse (BGB §556d) — caps 2026 rent at €1,650 (source_prior = 0.94)",
    kind: "legal",
    title: "legal-memo-2026.pdf",
    raw_excerpt:
      "Memo · Kanzlei Weber & Kollegen, 2026-04-22. Betreff: Mietpreisbremse Berliner Str. 42 Apt 3. §4 — " +
      "Gemäß § Mietpreisbremse (BGB §556d) ist die zulässige Miete ab dem 1. Juni 2026 auf EUR 1.650,00 gedeckelt. " +
      "Der vom Vermieter geforderte Betrag von EUR 1.800 ist nicht durchsetzbar.",
    source_prior: 0.94,
  },
];
