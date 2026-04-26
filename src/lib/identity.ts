// path: src/lib/identity.ts
/**
 * Identity resolution + prefetch.
 *
 * When an email lands, we look up the sender in the fact store. If we know
 * who they are (owner / tenant / contractor), we surface that match in the
 * audit log and pre-warm the relevant Context.md files so the property
 * manager's first query is already cached.
 *
 * The lookup is a bitemporal-aware fact query — only currently-valid email
 * facts (`known_to IS NULL`) participate.
 */

import { db } from "./db";
import { recordAction } from "./actions";

// ── Types ───────────────────────────────────────────────────────────────────

export type IdentityRole = "owner" | "tenant" | "contractor" | "unknown";

export type ResolvedIdentity = {
  email: string;
  entity_id: string | null;
  role: IdentityRole;
  name: string | null;
  /** For owners: their unit ids. For tenants: units they rent. Empty otherwise. */
  related_units: string[];
};

// ── Email → entity resolver ─────────────────────────────────────────────────

const EMAIL_PREDICATES = [
  "identity.email",
  "communication.email",
  "contacts.verwalter.email",
] as const;

/**
 * Find which entity owns this email address. Returns null if no match.
 * Lookup is case-insensitive and trims surrounding whitespace.
 */
export function resolveEmailToEntity(email: string): ResolvedIdentity {
  const norm = email.trim().toLowerCase();
  if (!norm || !norm.includes("@")) {
    return { email, entity_id: null, role: "unknown", name: null, related_units: [] };
  }

  const placeholders = EMAIL_PREDICATES.map((_, i) => `@p${i}`).join(",");
  const params: Record<string, string> = { email: norm };
  EMAIL_PREDICATES.forEach((p, i) => {
    params[`p${i}`] = p;
  });

  const row = db()
    .prepare(
      `SELECT entity FROM facts
       WHERE predicate IN (${placeholders})
         AND LOWER(value) = @email
         AND known_to IS NULL
       LIMIT 1`,
    )
    .get(params) as { entity: string } | undefined;

  if (!row) {
    return { email, entity_id: null, role: "unknown", name: null, related_units: [] };
  }

  const role = entityRole(row.entity);
  const name = entityDisplayName(row.entity);
  const related_units = role === "owner"
    ? getOwnerUnits(row.entity)
    : role === "tenant"
      ? getTenantUnits(row.entity)
      : [];

  return { email, entity_id: row.entity, role, name, related_units };
}

function entityRole(entityId: string): IdentityRole {
  if (entityId.startsWith("owner:")) return "owner";
  if (entityId.startsWith("tenant:")) return "tenant";
  if (entityId.startsWith("contractor:")) return "contractor";
  return "unknown";
}

function entityDisplayName(entityId: string): string | null {
  const row = db()
    .prepare(`SELECT name FROM entities WHERE id = @id`)
    .get({ id: entityId }) as { name: string } | undefined;
  return row?.name ?? null;
}

// ── Ownership / tenancy graph helpers ───────────────────────────────────────

/**
 * Units owned by the given owner entity. Returns canonical unit entity ids
 * (e.g. "unit:EH-047"), normalizing the raw "EH-047" stored in the value.
 */
export function getOwnerUnits(ownerEntityId: string): string[] {
  const rows = db()
    .prepare(
      `SELECT DISTINCT value FROM facts
       WHERE entity = @entity
         AND predicate = 'ownership.unit'
         AND known_to IS NULL
         AND superseded_by IS NULL`,
    )
    .all({ entity: ownerEntityId }) as Array<{ value: string }>;
  return rows.map((r) => normalizeUnitId(r.value));
}

/**
 * Units this tenant has rented (current and past). Looks up unit.tenant
 * facts globally — bitemporal-aware so historical tenancies are visible.
 */
export function getTenantUnits(tenantEntityId: string): string[] {
  const tenantNum = tenantEntityId.replace(/^tenant:/, "");
  const rows = db()
    .prepare(
      `SELECT DISTINCT entity FROM facts
       WHERE predicate = 'unit.tenant'
         AND (value = @full OR value = @bare)
         AND known_to IS NULL`,
    )
    .all({ full: tenantEntityId, bare: tenantNum }) as Array<{ entity: string }>;
  return rows.map((r) => r.entity);
}

function normalizeUnitId(raw: string): string {
  if (raw.startsWith("unit:")) return raw;
  return `unit:${raw}`;
}

// ── Prefetch ────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: load the rendered Context.md for each related entity so
 * the SQLite query plans are warm and any file-system caches are touched.
 * Runs in the background — never blocks the ingest path. Errors are swallowed.
 */
export function prefetchContexts(
  entityIds: string[],
  origin: string,
): void {
  if (entityIds.length === 0) return;
  for (const id of entityIds) {
    const url = `${origin}/api/context/${encodeURIComponent(id)}?detail=3`;
    // Don't await — the goal is to warm caches, not block the response.
    fetch(url, { method: "GET" }).catch(() => {});
  }
}

// ── Hook for the ingest pipeline ────────────────────────────────────────────

/**
 * Called from ingest after the source row is inserted. If the source carries
 * a sender email and we can identify them, record an `identity.resolved`
 * action and trigger a context prefetch for related units.
 *
 * Returns the resolved identity so the caller can surface it in the response.
 */
export function recordIdentityMatch(opts: {
  source_id: string;
  entity: string;
  from_addr?: string | null;
  origin?: string;
}): ResolvedIdentity | null {
  const from = opts.from_addr?.trim();
  if (!from || !from.includes("@")) return null;

  const resolved = resolveEmailToEntity(from);
  if (!resolved.entity_id) {
    recordAction({
      actor: "system",
      action: "identity.unresolved",
      entity: opts.entity,
      target: opts.source_id,
      input: { from_addr: from },
      output: { matched: false },
    });
    return resolved;
  }

  recordAction({
    actor: "system",
    action: "identity.resolved",
    entity: opts.entity,
    target: opts.source_id,
    input: { from_addr: from },
    output: {
      matched_entity: resolved.entity_id,
      role: resolved.role,
      name: resolved.name,
      related_units: resolved.related_units,
    },
  });

  // Prefetch the matched entity + related units. Origin is required for the
  // absolute URL inside Node fetch.
  if (opts.origin) {
    const ids = [resolved.entity_id, ...resolved.related_units];
    prefetchContexts(ids, opts.origin);
  }

  return resolved;
}
