// path: src/lib/route-doc.ts
/**
 * Shared per-document routing for the upload paths. Same logic used by
 * /api/upload (single file), /api/upload-bulk (zip), and seed.ts (cold load):
 *
 *   1. Probe-extract the doc to read recipient.name / invoice.vendor.
 *   2. Match against the live tenant / owner / contractor catalog.
 *   3. If no match, AUTO-CREATE the entity from the recipient/vendor name
 *      and insert a backing identity.name fact. The next file in the same
 *      upload that mentions the same name reuses the just-created entity.
 *
 * Auto-creation is always on. The user explicitly asked for this — empty-
 * engine sandbox uploads should self-bootstrap their entity catalog from the
 * documents alone.
 */

import {
  db,
  getEntity,
  ident,
  insertEntity,
  insertFact,
  insertSource,
  listEntities,
  newFactId,
  newSourceId,
  getAllFactsForEntity,
} from "./db";
import { extractSync } from "./extractor";
import { ENTITY } from "./seed";
import { RAW_EXCERPT_BYTES, type EntityType, type Source } from "./types";

export type Router = {
  tenantByName: Map<string, string>;
  ownerByName: Map<string, string>;
  contractorByFirma: Map<string, string>;
};

/**
 * Strip a leading German salutation so we match a recipient name in a PDF
 * (typically just "Magrit Mitschke") against an entity whose name includes
 * the salutation ("Frau Magrit Mitschke"). Without this normalisation the
 * router auto-created phantom entities (tenant:magrit-mitschke alongside
 * the real tenant:MIE-016) for every Hausverwaltung letter.
 */
function stripSalutation(name: string): string {
  return name.replace(/^\s*(?:frau|herr|herrn|firma|familie)\s+/i, "").trim();
}

export function buildRouter(): Router {
  const tenantByName = new Map<string, string>();
  const ownerByName = new Map<string, string>();
  const contractorByFirma = new Map<string, string>();
  for (const e of listEntities({ type: "tenant" })) {
    tenantByName.set(e.name.toLowerCase(), e.id);
    tenantByName.set(stripSalutation(e.name).toLowerCase(), e.id);
  }
  for (const e of listEntities({ type: "owner" })) {
    ownerByName.set(e.name.toLowerCase(), e.id);
    ownerByName.set(stripSalutation(e.name).toLowerCase(), e.id);
  }
  for (const e of listEntities({ type: "contractor" })) {
    const facts = getAllFactsForEntity(e.id).filter((f) => f.known_to === null);
    const firma = facts.find((f) => f.predicate === "identity.firma")?.value as
      | string
      | undefined;
    const norm = (firma ?? e.name).toLowerCase();
    contractorByFirma.set(norm, e.id);
    const firstWord = norm.split(/\s+/)[0];
    if (firstWord && firstWord.length > 3) contractorByFirma.set(firstWord, e.id);
  }
  return { tenantByName, ownerByName, contractorByFirma };
}

/**
 * Route a single document to the right entity. Mutates the router so an
 * auto-created entity is reused by later files in the same upload.
 */
export function routeForDoc(
  router: Router,
  filename: string,
  text: string,
): { entity: string; auto_created: boolean; how: string } {
  const isInvoice =
    /invoice|rechnung/i.test(filename) || /Rechnungsnr|Invoice\s+No/i.test(text);
  const isEtv = /etv_/i.test(filename);
  if (isEtv) return { entity: ENTITY, auto_created: false, how: "etv→weg" };

  const probeFacts = extractSync("probe", {
    id: "probe",
    kind: isInvoice ? "invoice" : "letter",
    title: filename,
    ingested_at: new Date().toISOString(),
    raw_excerpt: text.slice(0, RAW_EXCERPT_BYTES),
    source_prior: 0.9,
  } as Source);

  if (isInvoice) {
    const vendor = probeFacts.find((f) => f.predicate === "invoice.vendor")?.value;
    if (typeof vendor === "string") {
      const v = vendor.toLowerCase();
      for (const [name, id] of router.contractorByFirma) {
        if (v.includes(name)) {
          return { entity: id, auto_created: false, how: "invoice→contractor" };
        }
      }
      // No match → auto-create the contractor.
      const id = autoCreate("contractor", vendor);
      router.contractorByFirma.set(vendor.toLowerCase(), id);
      return { entity: id, auto_created: true, how: "invoice→contractor (auto-created)" };
    }
    return { entity: ENTITY, auto_created: false, how: "weg-fallback" };
  }

  const recipient = probeFacts.find((f) => f.predicate === "recipient.name")?.value;
  if (typeof recipient === "string") {
    const r = recipient.toLowerCase();
    const rBare = stripSalutation(recipient).toLowerCase();
    const tid = router.tenantByName.get(r) ?? router.tenantByName.get(rBare);
    if (tid) return { entity: tid, auto_created: false, how: "letter→tenant" };
    const oid = router.ownerByName.get(r) ?? router.ownerByName.get(rBare);
    if (oid) return { entity: oid, auto_created: false, how: "letter→owner" };

    // No match → auto-create. Use letter.kind as a heuristic for tenant vs owner:
    //   Hausgeld + ETV → owner; everything else (Mahnung, Kündigung,
    //   Mieterhöhung, Nebenkostenabrechnung) → tenant.
    const kind = probeFacts.find((f) => f.predicate === "letter.kind")?.value;
    const targetType: "tenant" | "owner" =
      kind === "hausgeld" || kind === "etv_einladung" || kind === "etv_protokoll"
        ? "owner"
        : "tenant";
    const id = autoCreate(targetType, recipient);
    if (targetType === "tenant") router.tenantByName.set(r, id);
    else router.ownerByName.set(r, id);
    return {
      entity: id,
      auto_created: true,
      how: `letter→${targetType} (auto-created)`,
    };
  }

  return { entity: ENTITY, auto_created: false, how: "weg-fallback" };
}

// ── Auto-create ─────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "auto"
  );
}

/**
 * Insert a new entity + a single identity.name fact backed by a synthetic
 * "auto-created from upload" source. Idempotent: returns the existing id if
 * the slug already exists.
 */
function autoCreate(type: EntityType, name: string): string {
  const slug = slugify(name);
  const id = `${type}:${slug}`;
  if (getEntity(id)) return id;

  const now = new Date().toISOString();
  insertEntity({
    id,
    type,
    name,
    parent_id: type === "contractor" ? null : ENTITY,
    meta: { auto_created: true, source: "document upload" },
    created_at: now,
  });

  const sourceId = newSourceId(`auto:${id}`);
  insertSource({
    id: sourceId,
    kind: "stammdaten",
    title: `Auto-created from upload — ${name}`,
    ingested_at: now,
    raw_excerpt: `Entity inferred from a document recipient/vendor: ${name}`,
    source_prior: 0.6,
    entity_id: id,
  });

  // Predicate name varies by type so the entity profile shows the right field.
  const predicate = type === "contractor" ? "identity.firma" : "identity.name";
  insertFact({
    id: newFactId(),
    entity: id,
    predicate,
    value: name,
    unit: undefined,
    valid_from: null,
    valid_to: null,
    known_from: now,
    known_to: null,
    source: sourceId,
    span: { start: 0, end: name.length, quote: name },
    confidence: 0.7,
    superseded_by: null,
    ident: ident(id, predicate, null),
  });

  // Suppress unused-import warning for `db` — kept around so callers can
  // extend this helper with extra checks (e.g. dedup on alternate predicates).
  void db;
  return id;
}
