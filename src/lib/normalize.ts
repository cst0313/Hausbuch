// path: src/lib/normalize.ts
/**
 * Schema alignment — resolve source-specific predicate names to canonical
 * Hausbuch predicates.
 *
 * Buena track §1: "'owner' is called Eigentümer, MietEig, Kontakt, or owner
 * depending on the source system. You must resolve identities across ERPs."
 *
 * The canonical vocabulary is {section}.{field} (dot-nested):
 *   identity.owner, identity.address, identity.units, identity.year_built
 *   tenancy.tenant, tenancy.rent.base, tenancy.rent.next, tenancy.start, tenancy.end
 *   condition.last_inspection, condition.open_tickets
 *   contact.primary, contact.landlord_email, contact.manager
 *
 * Aliases map dozens of real-world source names to these canonical keys.
 * Unknown keys pass through unchanged so extractors can still emit new
 * predicates without pre-registration.
 */

export type NormalizedPredicate = {
  canonical: string;
  aliased_from?: string; // the original if it got rewritten
  known: boolean;        // true if canonical was in the registry
};

/**
 * Alphabetized alias table. New entries should lowercase the left side
 * (matching is case-insensitive). RHS is always the canonical key.
 */
const ALIASES: Record<string, string> = {
  // identity.owner — dozens of real ERP / CRM / PDF names for the same thing
  "owner": "identity.owner",
  "eigentümer": "identity.owner",
  "eigentuemer": "identity.owner",
  "eigentum": "identity.owner",
  "mieteig": "identity.owner",         // Mieter- vs Eigentümer short-form
  "hauseigentümer": "identity.owner",
  "hauseigentuemer": "identity.owner",
  "vermieter": "identity.owner",
  "landlord": "identity.owner",
  "property_owner": "identity.owner",
  "owning_entity": "identity.owner",
  "owning_company": "identity.owner",
  "owner_name": "identity.owner",
  "owned_by": "identity.owner",

  // identity.address
  "address": "identity.address",
  "property_address": "identity.address",
  "adresse": "identity.address",
  "anschrift": "identity.address",
  "standort": "identity.address",
  "location": "identity.address",

  // identity.units
  "units": "identity.units",
  "unit_count": "identity.units",
  "apt_count": "identity.units",
  "wohneinheiten": "identity.units",
  "einheiten": "identity.units",
  "wohnungen": "identity.units",
  "apartments": "identity.units",
  "flats": "identity.units",
  "residential_units": "identity.units",

  // identity.year_built
  "year_built": "identity.year_built",
  "baujahr": "identity.year_built",
  "construction_year": "identity.year_built",
  "built_in": "identity.year_built",

  // identity.floor_area_m2
  "floor_area_m2": "identity.floor_area_m2",
  "wohnfläche": "identity.floor_area_m2",
  "wohnflaeche": "identity.floor_area_m2",
  "floor_area": "identity.floor_area_m2",

  // tenancy.tenant
  "tenant": "tenancy.tenant",
  "mieter": "tenancy.tenant",
  "mietername": "tenancy.tenant",
  "renter": "tenancy.tenant",
  "resident": "tenancy.tenant",
  "lessee": "tenancy.tenant",
  "occupant": "tenancy.tenant",
  "tenant_name": "tenancy.tenant",
  "inhaber": "tenancy.tenant",

  // tenancy.rent.base / .next
  "rent": "tenancy.rent.base",
  "current_rent": "tenancy.rent.base",
  "base_rent": "tenancy.rent.base",
  "monthly_rent": "tenancy.rent.base",
  "kaltmiete": "tenancy.rent.base",
  "grundmiete": "tenancy.rent.base",
  "miete": "tenancy.rent.base",
  "rent_base": "tenancy.rent.base",
  "next_rent": "tenancy.rent.next",
  "proposed_rent": "tenancy.rent.next",
  "rent_next": "tenancy.rent.next",
  "new_rent": "tenancy.rent.next",
  "rent_increase": "tenancy.rent.next",
  "mieterhöhung": "tenancy.rent.next",

  // tenancy.start / .end
  "tenancy_start": "tenancy.start",
  "lease_start": "tenancy.start",
  "move_in": "tenancy.start",
  "mietbeginn": "tenancy.start",
  "vertragsbeginn": "tenancy.start",
  "tenancy_end": "tenancy.end",
  "lease_end": "tenancy.end",
  "move_out": "tenancy.end",
  "vertragsende": "tenancy.end",
  "befristet_bis": "tenancy.end",
  "expiry": "tenancy.end",
  "expires": "tenancy.end",

  // condition
  "last_inspection": "condition.last_inspection",
  "inspection_date": "condition.last_inspection",
  "letzte_inspektion": "condition.last_inspection",
  "letzte_begehung": "condition.last_inspection",
  "inspected": "condition.last_inspection",
  "open_tickets": "condition.open_tickets",
  "offene_tickets": "condition.open_tickets",
  "maintenance_tickets": "condition.open_tickets",
  "maintenance_issues": "condition.open_tickets",
  "open_issues": "condition.open_tickets",
  "work_orders": "condition.open_tickets",

  // contact
  "landlord_email": "contact.landlord_email",
  "vermieter_email": "contact.landlord_email",
  "contact": "contact.primary",
  "kontakt": "contact.primary",
  "ansprechpartner": "contact.primary",
  "manager": "contact.manager",
  "verwalter": "contact.manager",
  "hausverwaltung": "contact.manager",
};

/** Set of canonical keys the system recognises as "known". */
const CANONICAL = new Set(Object.values(ALIASES));

/**
 * Normalize a raw predicate to its canonical form.
 *
 * Examples:
 *   normalize("Eigentümer")       → { canonical: "identity.owner", aliased_from: "Eigentümer", known: true }
 *   normalize("MietEig")          → { canonical: "identity.owner", aliased_from: "MietEig",    known: true }
 *   normalize("identity.owner")   → { canonical: "identity.owner", known: true }
 *   normalize("anything_else")    → { canonical: "anything_else",  known: false }
 */
export function normalizePredicate(raw: string): NormalizedPredicate {
  const trimmed = raw.trim();
  const lowered = trimmed.toLowerCase();

  // Already canonical → return as-is
  if (CANONICAL.has(trimmed)) return { canonical: trimmed, known: true };

  // Look up in alias table (lowercase match)
  if (ALIASES[lowered]) {
    return {
      canonical: ALIASES[lowered],
      aliased_from: trimmed,
      known: true,
    };
  }

  // Also try with separators stripped: "Vertrags-Ende" → "vertragsende"
  const stripped = lowered.replace(/[\s_-]+/g, "");
  if (ALIASES[stripped]) {
    return {
      canonical: ALIASES[stripped],
      aliased_from: trimmed,
      known: true,
    };
  }

  // Unknown — pass through unchanged
  return { canonical: trimmed, known: false };
}

/**
 * For diagnostics — how many canonical predicates exist and how many aliases map to each.
 */
export function aliasCoverage(): Array<{ canonical: string; alias_count: number; aliases: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const [alias, canonical] of Object.entries(ALIASES)) {
    const list = grouped.get(canonical) ?? [];
    list.push(alias);
    grouped.set(canonical, list);
  }
  return Array.from(grouped.entries())
    .map(([canonical, aliases]) => ({ canonical, alias_count: aliases.length, aliases }))
    .sort((a, b) => b.alias_count - a.alias_count);
}
