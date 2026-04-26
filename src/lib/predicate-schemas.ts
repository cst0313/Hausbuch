// path: src/lib/predicate-schemas.ts
/**
 * Allowed values per predicate. Used by:
 *   - /api/correct  → rejects out-of-schema values (server-side validation)
 *   - FactRow UI    → renders a select dropdown for enum predicates
 *
 * Predicates not listed here are free-form strings. Add a key here when a
 * predicate becomes enum-shaped to lock it down.
 */

export type PredicateSchema =
  | { kind: "enum"; values: readonly string[] }
  | { kind: "boolean" }
  | { kind: "number"; min?: number; max?: number }
  | { kind: "date" }
  | { kind: "currency_eur" }
  | { kind: "string"; maxLen?: number };

export const PREDICATE_SCHEMAS: Record<string, PredicateSchema> = {
  // ── Incidents ────────────────────────────────────────────────────────────
  "incident.type": {
    kind: "enum",
    values: [
      "water_damage",
      "mold",
      "lock_issue",
      "heating",
      "elevator",
      "noise",
      "electrical",
      "other",
    ],
  },
  "incident.status": {
    kind: "enum",
    values: ["reported", "in_progress", "awaiting_contractor", "resolved", "escalated", "closed"],
  },

  // ── Tenancy ──────────────────────────────────────────────────────────────
  "tenancy.kaltmiete": { kind: "currency_eur" },
  "tenancy.warmmiete": { kind: "currency_eur" },
  "tenancy.nebenkosten": { kind: "currency_eur" },
  "tenancy.kaution": { kind: "currency_eur" },
  "tenancy.start": { kind: "date" },
  "tenancy.end": { kind: "date" },
  "tenancy.mieterwechsel": { kind: "boolean" },

  // ── Financial ────────────────────────────────────────────────────────────
  "financial.miete": { kind: "currency_eur" },
  "financial.hausgeld": { kind: "currency_eur" },
  "financial.invoice.amount": { kind: "currency_eur" },
  "financial.mahnung": { kind: "boolean" },

  // ── Legal ────────────────────────────────────────────────────────────────
  "legal.kuendigung": { kind: "boolean" },
  "legal.mietminderung": { kind: "boolean" },
  "legal.mietminderung.prozent": { kind: "number", min: 0, max: 100 },
  "legal.verkaufsabsicht": { kind: "boolean" },

  // ── Identity ─────────────────────────────────────────────────────────────
  "identity.email": { kind: "string", maxLen: 200 },
  "identity.telefon": { kind: "string", maxLen: 64 },
  "identity.address": { kind: "string", maxLen: 240 },
  "identity.firma": { kind: "string", maxLen: 200 },
  "identity.branche": { kind: "string", maxLen: 100 },

  // ── Conditions ───────────────────────────────────────────────────────────
  "condition.last_inspection": { kind: "date" },
  "condition.next_inspection": { kind: "date" },

  // ── Unit ─────────────────────────────────────────────────────────────────
  "unit.flaeche": { kind: "number", min: 0, max: 10_000 },
  "unit.zimmer": { kind: "number", min: 0, max: 30 },
};

export type ValidationResult =
  | { ok: true; normalized: string }
  | { ok: false; reason: string; allowed?: readonly string[] };

export function validateFactValue(predicate: string, raw: string): ValidationResult {
  const trimmed = String(raw).trim();
  if (!trimmed) return { ok: false, reason: "Value is empty." };

  const schema = PREDICATE_SCHEMAS[predicate];
  if (!schema) {
    // Unknown predicate → free text, but cap length for sanity.
    if (trimmed.length > 1000) return { ok: false, reason: "Value too long (>1000 chars)." };
    return { ok: true, normalized: trimmed };
  }

  switch (schema.kind) {
    case "enum": {
      const lower = trimmed.toLowerCase();
      const hit = schema.values.find((v) => v.toLowerCase() === lower);
      if (!hit) {
        return {
          ok: false,
          reason: `Value not in allowed set for ${predicate}.`,
          allowed: schema.values,
        };
      }
      return { ok: true, normalized: hit };
    }
    case "boolean": {
      const lower = trimmed.toLowerCase();
      if (["true", "false", "yes", "no", "ja", "nein", "1", "0"].includes(lower)) {
        const isTrue = ["true", "yes", "ja", "1"].includes(lower);
        return { ok: true, normalized: isTrue ? "true" : "false" };
      }
      return { ok: false, reason: "Boolean predicate accepts true/false/yes/no/ja/nein only." };
    }
    case "number": {
      const n = Number(trimmed.replace(/,/g, "."));
      if (!Number.isFinite(n)) return { ok: false, reason: "Not a number." };
      if (schema.min !== undefined && n < schema.min) {
        return { ok: false, reason: `Below minimum (${schema.min}).` };
      }
      if (schema.max !== undefined && n > schema.max) {
        return { ok: false, reason: `Above maximum (${schema.max}).` };
      }
      return { ok: true, normalized: String(n) };
    }
    case "date": {
      // Accept YYYY-MM-DD or DD.MM.YYYY
      const iso = trimmed.match(/^\d{4}-\d{2}-\d{2}$/);
      if (iso) return { ok: true, normalized: trimmed };
      const de = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (de) return { ok: true, normalized: `${de[3]}-${de[2]}-${de[1]}` };
      return { ok: false, reason: "Date must be YYYY-MM-DD or DD.MM.YYYY." };
    }
    case "currency_eur": {
      // Accept "1.234,56 €", "1,234.56", "842"
      const cleaned = trimmed.replace(/€|\s|EUR/gi, "");
      const normalized = cleaned.replace(/\./g, "").replace(",", ".");
      const n = Number(normalized);
      if (!Number.isFinite(n) || n < 0) return { ok: false, reason: "Not a valid amount in €." };
      return { ok: true, normalized: String(n) };
    }
    case "string": {
      if (schema.maxLen !== undefined && trimmed.length > schema.maxLen) {
        return { ok: false, reason: `Value too long (>${schema.maxLen} chars).` };
      }
      return { ok: true, normalized: trimmed };
    }
  }
}

/** Convenience accessor for the UI — returns the schema or null. */
export function getPredicateSchema(predicate: string): PredicateSchema | null {
  return PREDICATE_SCHEMAS[predicate] ?? null;
}
