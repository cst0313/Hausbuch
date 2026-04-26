// path: src/lib/recommendations.ts
/**
 * Rule-based recommendation engine.
 *
 * Scans the fact store for open incidents, pending actions, and overdue items
 * across all entities. Returns prioritized recommendations with:
 *   - What happened (incident summary)
 *   - Who's involved (tenant, owner, contractor)
 *   - What to do next (dispatch, draft, escalate)
 *   - Draft-ready context for Gemini email generation
 *
 * No LLM calls — pure fact-store queries. Lightning fast.
 */

import { db, getEntity, listEntities, getAllFactsForEntity, getSource } from "./db";
import type { Entity, Fact, Source } from "./types";
import { getReputation, type Reputation } from "./reputation";

// ── Types ───────────────────────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low";

export type RecommendedAction = {
  type: "dispatch_contractor" | "draft_email" | "escalate" | "follow_up" | "review";
  label: string;
  label_de: string;
  recipient?: { entity_id: string; name: string; email?: string; role: string };
  draft_context?: DraftContext;
  /** Reputation summary when the recipient is a contractor. */
  reputation?: {
    score: number;
    band: Reputation["band"];
    incidents_open: number;
    incidents_total: number;
    mahnung_count: number;
    last_incident_at: string | null;
    /** If we swapped from a worse contractor, the original we considered. */
    avoided?: { entity_id: string; name: string; score: number };
  };
};

export type DraftContext = {
  from: string;
  to: string;
  to_email: string;
  subject: string;
  incident_summary: string;
  entity_context: string;
  language: "de" | "en";
  tone: "formal" | "urgent";
};

export type Recommendation = {
  id: string;
  severity: Severity;
  entity_id: string;
  entity_name: string;
  entity_type: string;
  category: string;
  /** German title (default). */
  title: string;
  /** English title. UI picks based on locale. */
  title_en: string;
  /** German summary (default). */
  summary: string;
  /** English summary. UI picks based on locale. */
  summary_en: string;
  facts: Array<{
    predicate: string;
    value: string;
    source_title: string;
    known_from: string;
    valid_from?: string | null;
    valid_to?: string | null;
  }>;
  email_chain: Array<{ source_id: string; title: string; from: string; date: string; excerpt: string }>;
  actions: RecommendedAction[];
  /** Reputation summary on the focal entity — used to flag problem tenants/contractors. */
  entity_reputation?: {
    score: number;
    band: Reputation["band"];
    incidents_open: number;
    incidents_total: number;
    mahnung_count: number;
    /** For tenants: list of unit ids they've been associated with (cross-unit history). */
    related_units?: string[];
  };
  created_at: string;
};

// ── Main entry ──────────────────────────────────────────────────────────────

// Process-wide TTL cache — recommendations rebuild from facts is O(N entities × N facts)
// and runs ~2s on the demo corpus. The list only changes when an ingest writes new
// facts; for everything else (palette, dashboard refresh) a 15s window is fine.
let _cache: { at: number; value: Recommendation[] } | null = null;
const CACHE_TTL_MS = 15_000;

export function invalidateRecommendationsCache(): void {
  _cache = null;
}

export function getRecommendations(): Recommendation[] {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return _cache.value;
  }
  const value = computeRecommendations();
  _cache = { at: Date.now(), value };
  return value;
}

function computeRecommendations(): Recommendation[] {
  const recs: Recommendation[] = [];

  // Scan all entities for incidents, legal issues, financial problems
  const allEntities = listEntities();
  const contractors = allEntities.filter(e => e.type === "contractor");
  const contractorMap = new Map(contractors.map(c => [c.id, c]));

  for (const entity of allEntities) {
    const facts = getAllFactsForEntity(entity.id).filter(f => f.known_to === null);

    // Group facts by predicate family
    const incidents = facts.filter(f => f.predicate.startsWith("incident."));
    const legal = facts.filter(f => f.predicate.startsWith("legal."));
    const financial = facts.filter(f => f.predicate.startsWith("financial."));
    const communications = facts.filter(f => f.predicate === "communication.email");

    // Build email chain for this entity
    const emailChain = buildEmailChain(communications);

    // Incident-based recommendations
    for (const incident of groupIncidents(incidents)) {
      const rec = buildIncidentRecommendation(entity, incident, emailChain, contractorMap, allEntities);
      if (rec) recs.push(rec);
    }

    // Legal issue recommendations (Mietminderung, Kündigung)
    for (const fact of legal) {
      const rec = buildLegalRecommendation(entity, fact, legal, emailChain, allEntities);
      if (rec) recs.push(rec);
    }
  }

  // Sort: critical first, then by date (newest first)
  recs.sort((a, b) => {
    const sevOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const sd = sevOrder[a.severity] - sevOrder[b.severity];
    if (sd !== 0) return sd;
    return b.created_at.localeCompare(a.created_at);
  });

  // Deduplicate by entity + category
  const seen = new Set<string>();
  const deduped = recs.filter(r => {
    const key = `${r.entity_id}:${r.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Annotate tenant + contractor recs with their entity reputation. Owners
  // are skipped — reputation is meaningful for parties we'd dispatch / engage.
  for (const r of deduped) {
    if (r.entity_type === "tenant" || r.entity_type === "contractor") {
      const rep = getReputation(r.entity_id);
      if (rep.incidents_total > 0 || rep.mahnung_count > 0 || rep.band !== "neutral") {
        r.entity_reputation = {
          score: rep.score,
          band: rep.band,
          incidents_open: rep.incidents_open,
          incidents_total: rep.incidents_total,
          mahnung_count: rep.mahnung_count,
          related_units:
            r.entity_type === "tenant" ? tenantRelatedUnits(r.entity_id) : undefined,
        };
      }
    }
  }

  return deduped;
}

/**
 * Units a tenant has been associated with — pulled from unit.tenant facts
 * across the corpus. Returns canonical unit entity ids (e.g. "unit:EH-016").
 */
function tenantRelatedUnits(tenantEntityId: string): string[] {
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

// ── Incident grouping ───────────────────────────────────────────────────────

type IncidentGroup = {
  type: string;
  status: string;
  facts: Fact[];
};

function groupIncidents(facts: Fact[]): IncidentGroup[] {
  // Bucket each `incident.type` fact by its value AND by its source — each
  // distinct source represents a real, separately-reported incident even if
  // it happens to share a type with an older one. (Without this, a tenant
  // who reports water_damage twice over a year would only get one rec, and
  // the email_chain would be the union of both reports.)
  const byType = new Map<string, Fact[]>();
  for (const f of facts) {
    if (f.predicate === "incident.type") {
      const t = String(f.value);
      byType.set(t, [...(byType.get(t) ?? []), f]);
    }
  }

  // Sources of the incident.type facts — used to scope which incident.status
  // facts belong to which type (so the heating rec doesn't pick up the mold
  // status).
  const groups: IncidentGroup[] = [];
  for (const [type, typeFacts] of byType) {
    const typeSourceIds = new Set(typeFacts.map((f) => f.source));
    // Pick the status fact whose source matches one of THIS type's incident
    // sources. Falls back to the most recent of any status if no exact match
    // (e.g. older data without paired status facts).
    const matchedStatus = facts
      .filter((f) => f.predicate === "incident.status" && typeSourceIds.has(f.source))
      .sort((a, b) => (b.known_from ?? "").localeCompare(a.known_from ?? ""))[0];
    const fallbackStatus = facts.find((f) => f.predicate === "incident.status");
    const statusFact = matchedStatus ?? fallbackStatus;

    // CRITICAL: incident.facts must be ONLY this type's own facts.
    // Polluting with the entity's other facts caused per-type recs to share
    // an email_chain (the most recent unrelated email always won), which
    // looked to users like the system was misclassifying their report.
    groups.push({
      type,
      status: statusFact ? String(statusFact.value) : "reported",
      facts: typeFacts,
    });
  }
  return groups;
}

// ── Build recommendations ───────────────────────────────────────────────────

function buildIncidentRecommendation(
  entity: Entity,
  incident: IncidentGroup,
  emailChain: Recommendation["email_chain"],
  contractors: Map<string, Entity>,
  allEntities: Entity[],
): Recommendation | null {
  const severity = incidentSeverity(incident.type, incident.status);

  // Scope email_chain to ONLY the emails that actually triggered this incident.
  // The default `emailChain` is the entity's last 5 messages of ANY topic —
  // when none of those happen to be the incident's source, falling back to
  // the unscoped chain shows wildly unrelated subject lines (e.g. an old
  // lock_issue rec showing "Re: Internet/TV-Anschluss" because that was the
  // tenant's most recent email about something else entirely).
  // Now we ALWAYS replace the chain with the actual incident sources, even if
  // empty — better to show "no email chain" than the wrong one.
  const incidentSourceIds = Array.from(new Set(incident.facts.map((f) => f.source)));
  if (incidentSourceIds.length > 0) {
    const placeholders = incidentSourceIds.map((_, i) => `@s${i}`).join(",");
    const args: Record<string, string> = {};
    incidentSourceIds.forEach((s, i) => (args[`s${i}`] = s));
    type Row = {
      id: string;
      title: string;
      ingested_at: string;
      from_addr: string | null;
      raw_excerpt: string;
    };
    const rows = db()
      .prepare(
        `SELECT id, title, ingested_at, from_addr, raw_excerpt
           FROM sources
          WHERE id IN (${placeholders})
          ORDER BY ingested_at DESC
          LIMIT 5`,
      )
      .all(args) as Row[];
    emailChain = rows.map((r) => ({
      source_id: r.id,
      title: r.title,
      from: r.from_addr ?? "",
      date: r.ingested_at,
      excerpt: (r.raw_excerpt ?? "").slice(0, 200),
    }));
  } else {
    emailChain = [];
  }
  const title = incidentTitle(incident.type);
  const titleEn = incidentTitleEn(incident.type);
  const summary = incidentSummary(incident.type, entity, incident.facts);
  const summaryEn = incidentSummaryEn(incident.type, entity, incident.facts);

  // Find the right contractor for this incident type — reputation-aware:
  // the highest-scored contractor in the matching branche wins.
  const match = findContractor(incident.type, contractors);
  const contractor = match?.chosen;
  const alternatives = match?.alternatives ?? [];

  // If the most recent communication on this incident was OUTGOING (we
  // already sent a reply or dispatched a contractor), don't generate yet
  // another draft — the case is in "awaiting reply" state. The follow-up
  // action is the right next step, not a fresh draft. Driven by the source's
  // `direction` field that the email importer populates.
  //
  // We look at ALL sources for this entity, not just the ones tied to incident
  // facts — outbound replies rarely contain incident keywords ("Wir kümmern
  // uns" doesn't trigger any incident.* extractor), so the inbound complaint
  // would be the only fact-bearing source. The right signal is "did the
  // manager touch this entity AFTER the incident was reported?".
  const incidentReportedAt = incident.facts
    .map((f) => f.known_from)
    .filter((s) => !!s)
    .sort()
    .pop();
  const awaitingReply = isAwaitingReply(entity.id, incidentReportedAt);

  const actions: RecommendedAction[] = [];

  if (awaitingReply) {
    // Surface a single follow-up reminder so the manager knows the case is
    // open but already touched. No dispatch, no draft.
    const reporterEmail = findFactValue(entity.id, "identity.email");
    actions.push({
      type: "follow_up",
      label: `Follow up with ${entity.name} if no reply`,
      label_de: `Nachfassen bei ${entity.name} wenn keine Antwort`,
      ...(reporterEmail
        ? {
            recipient: {
              entity_id: entity.id,
              name: entity.name,
              email: reporterEmail,
              role: entity.type,
            },
          }
        : {}),
    });
  } else if (incident.status === "reported") {
    // Need to dispatch a contractor
    if (contractor) {
      const contractorEmail = contractor.meta?.email as string ?? findFactValue(contractor.id, "identity.email") ?? "";
      const dispatchAction: RecommendedAction = {
        type: "dispatch_contractor",
        label: `Dispatch ${contractor.name}`,
        label_de: `${contractor.name} beauftragen`,
        recipient: {
          entity_id: contractor.id,
          name: contractor.name,
          email: contractorEmail,
          role: "contractor",
        },
        draft_context: {
          from: "Huber & Partner Immobilienverwaltung GmbH <info@huber-partner-verwaltung.de>",
          to: contractor.name,
          to_email: contractorEmail,
          subject: `Reparaturauftrag: ${title} — ${entity.name}`,
          incident_summary: summary,
          entity_context: `Einheit: ${entity.name}, Typ: ${incident.type}`,
          language: "de",
          tone: incident.type === "water_damage" || incident.type === "mold" ? "urgent" : "formal",
        },
      };
      annotateContractorReputation(dispatchAction, contractor, alternatives);
      actions.push(dispatchAction);
    }

    // Also draft response to the reporting tenant/owner
    const reporterEmail = findFactValue(entity.id, "identity.email");
    if (reporterEmail) {
      actions.push({
        type: "draft_email",
        label: `Confirm receipt to ${entity.name}`,
        label_de: `Eingangsbestätigung an ${entity.name}`,
        recipient: {
          entity_id: entity.id,
          name: entity.name,
          email: reporterEmail,
          role: entity.type,
        },
        draft_context: {
          from: "Huber & Partner Immobilienverwaltung GmbH <info@huber-partner-verwaltung.de>",
          to: entity.name,
          to_email: reporterEmail,
          subject: `Re: ${title}`,
          incident_summary: summary,
          entity_context: `Betreff: ${title}. Status: In Bearbeitung.`,
          language: "de",
          tone: "formal",
        },
      });
    }
  }

  if (actions.length === 0) return null;

  // Get the triggering facts with source info
  const factDetails = incident.facts.slice(0, 5).map(f => {
    const src = getSource(f.source);
    return {
      predicate: f.predicate,
      value: String(f.value),
      source_title: src?.title ?? f.source,
      known_from: f.known_from,
      valid_from: f.valid_from ?? null,
      valid_to: f.valid_to ?? null,
    };
  });

  return {
    id: `rec:${entity.id}:${incident.type}`,
    severity,
    entity_id: entity.id,
    entity_name: entity.name,
    entity_type: entity.type,
    category: `incident.${incident.type}`,
    title,
    title_en: titleEn,
    summary,
    summary_en: summaryEn,
    facts: factDetails,
    email_chain: emailChain.slice(0, 5),
    actions,
    created_at: incident.facts[0]?.known_from ?? new Date().toISOString(),
  };
}

/**
 * Scope an email chain to a single triggering fact: same source, plus any
 * other sources sharing its thread_id (so the original report and its replies
 * stay together but unrelated emails get filtered out).
 *
 * Without this, every per-entity rec shows the entity's most recent email
 * as `chain[0]` regardless of topic — e.g. Ferenc Stahr's Mietminderung rec
 * was showing "Re: Internet/TV-Anschluss" because that was his last email.
 */
function chainForFact(fact: Fact): Recommendation["email_chain"] {
  type Row = {
    id: string;
    title: string;
    ingested_at: string;
    from_addr: string | null;
    raw_excerpt: string;
  };
  const rows = db()
    .prepare(
      `SELECT id, title, ingested_at, from_addr, raw_excerpt
         FROM sources
        WHERE id = @s
           OR (thread_id IS NOT NULL
               AND thread_id IN (SELECT thread_id FROM sources WHERE id = @s AND thread_id IS NOT NULL))
        ORDER BY ingested_at DESC
        LIMIT 5`,
    )
    .all({ s: fact.source }) as Row[];
  return rows.map((r) => ({
    source_id: r.id,
    title: r.title,
    from: r.from_addr ?? "",
    date: r.ingested_at,
    excerpt: (r.raw_excerpt ?? "").slice(0, 200),
  }));
}

function buildLegalRecommendation(
  entity: Entity,
  fact: Fact,
  allLegal: Fact[],
  emailChain: Recommendation["email_chain"],
  allEntities: Entity[],
): Recommendation | null {
  if (fact.predicate === "legal.mietminderung" && String(fact.value) === "true") {
    const pctFact = allLegal.find(f => f.predicate === "legal.mietminderung.prozent");
    const pct = pctFact ? String(pctFact.value) : "?";
    const src = getSource(fact.source);
    const awaitingReply = isAwaitingReply(entity.id, fact.known_from);

    return {
      id: `rec:${entity.id}:mietminderung`,
      severity: "critical",
      entity_id: entity.id,
      entity_name: entity.name,
      entity_type: entity.type,
      category: "legal.mietminderung",
      title: `Mietminderung ${pct}% angekündigt`,
      title_en: `Rent reduction ${pct}% announced`,
      summary: `${entity.name} hat eine Mietminderung um ${pct}% angekündigt. Rechtliche Prüfung und Mangelbehebung erforderlich.`,
      summary_en: `${entity.name} has announced a ${pct}% rent reduction. Legal review and remediation required.`,
      facts: (() => {
        const out: Recommendation["facts"] = [];
        if (pctFact) {
          out.push({
            predicate: "legal.mietminderung.prozent",
            value: String(pctFact.value),
            source_title: src?.title ?? pctFact.source,
            known_from: pctFact.known_from,
            valid_from: pctFact.valid_from ?? null,
            valid_to: pctFact.valid_to ?? null,
          });
        }
        out.push({
          predicate: fact.predicate,
          value: "true",
          source_title: src?.title ?? fact.source,
          known_from: fact.known_from,
          valid_from: fact.valid_from ?? null,
          valid_to: fact.valid_to ?? null,
        });
        return out;
      })(),
      email_chain: chainForFact(fact),
      actions: awaitingReply
        ? [
            // Already replied to the Mietminderung notice — escalation may
            // still be needed (legal review), but no fresh draft.
            {
              type: "escalate",
              label: "Legal review pending",
              label_de: "Rechtsprüfung läuft",
            },
            {
              type: "follow_up",
              label: `Follow up with ${entity.name} if no reply`,
              label_de: `Nachfassen bei ${entity.name} wenn keine Antwort`,
            },
          ]
        : [
            {
              type: "escalate",
              label: "Legal review needed",
              label_de: "Rechtliche Prüfung erforderlich",
            },
            {
              type: "dispatch_contractor",
              label: "Dispatch repair",
              label_de: "Reparatur beauftragen",
            },
            {
              type: "draft_email",
              label: `Respond to ${entity.name}`,
              label_de: `Antwort an ${entity.name}`,
              recipient: {
                entity_id: entity.id,
                name: entity.name,
                email: findFactValue(entity.id, "identity.email") ?? "",
                role: entity.type,
              },
              draft_context: {
                from: "Huber & Partner Immobilienverwaltung GmbH <info@huber-partner-verwaltung.de>",
                to: entity.name,
                to_email: findFactValue(entity.id, "identity.email") ?? "",
                subject: `Re: Mietminderung — ${entity.name}`,
                incident_summary: `Mietminderung ${pct}% angekündigt wegen Baumängeln.`,
                entity_context: `Mieter: ${entity.name}. Ankündigung: ${pct}% Minderung.`,
                language: "de",
                tone: "formal",
              },
            },
          ],
      created_at: fact.known_from,
    };
  }

  if (fact.predicate === "legal.kuendigung" && String(fact.value) === "true") {
    const src = getSource(fact.source);
    const awaitingReply = isAwaitingReply(entity.id, fact.known_from);
    return {
      id: `rec:${entity.id}:kuendigung`,
      severity: "high",
      entity_id: entity.id,
      entity_name: entity.name,
      entity_type: entity.type,
      category: "legal.kuendigung",
      title: "Kündigung eingegangen",
      title_en: "Termination received",
      summary: `${entity.name} hat den Mietvertrag gekündigt. Übergabetermin und Nachmietersuche einleiten.`,
      summary_en: `${entity.name} has terminated the lease. Schedule handover and start tenant search.`,
      facts: [{
        predicate: fact.predicate,
        value: "true",
        source_title: src?.title ?? fact.source,
        known_from: fact.known_from,
        valid_from: fact.valid_from ?? null,
        valid_to: fact.valid_to ?? null,
      }],
      email_chain: chainForFact(fact),
      actions: awaitingReply
        ? [
            // Confirmation already sent — only the operational follow-ups remain.
            {
              type: "follow_up",
              label: "Schedule handover",
              label_de: "Übergabetermin vereinbaren",
            },
            {
              type: "follow_up",
              label: `Awaiting reply from ${entity.name}`,
              label_de: `Wartet auf Antwort von ${entity.name}`,
            },
          ]
        : [
            {
              type: "follow_up",
              label: "Schedule handover",
              label_de: "Übergabetermin vereinbaren",
            },
            {
              type: "draft_email",
              label: `Confirm termination to ${entity.name}`,
              label_de: `Kündigungsbestätigung an ${entity.name}`,
              recipient: {
                entity_id: entity.id,
                name: entity.name,
                email: findFactValue(entity.id, "identity.email") ?? "",
                role: entity.type,
              },
              draft_context: {
                from: "Huber & Partner Immobilienverwaltung GmbH <info@huber-partner-verwaltung.de>",
                to: entity.name,
                to_email: findFactValue(entity.id, "identity.email") ?? "",
                subject: `Kündigungsbestätigung — ${entity.name}`,
                incident_summary: `Kündigung eingegangen.`,
                entity_context: `Mieter: ${entity.name}. Kündigung bestätigen, Übergabe planen.`,
                language: "de",
                tone: "formal",
              },
            },
          ],
      created_at: fact.known_from,
    };
  }

  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildEmailChain(communications: Fact[]): Recommendation["email_chain"] {
  return communications
    .sort((a, b) => b.known_from.localeCompare(a.known_from))
    .slice(0, 10)
    .map(f => {
      const src = getSource(f.source) ?? getSource(String(f.value));
      return {
        source_id: f.source,
        title: src?.title ?? String(f.value),
        from: src?.from_addr ?? "unknown",
        date: src?.ingested_at ?? f.known_from,
        excerpt: src?.raw_excerpt?.slice(0, 200) ?? "",
      };
    });
}

/**
 * True when the manager has sent any outgoing message to this entity AFTER
 * the most recent incident-bearing inbound. Drives the recommendation engine
 * to suggest "follow up" instead of generating yet another draft.
 *
 * Outbound replies almost never contain incident keywords (the manager writes
 * "Wir kümmern uns", not "Wasser tropft"), so they don't show up among the
 * incident's own facts. The signal we need is per-entity, not per-incident-fact.
 *
 * The email importer populates Source.direction = "incoming" | "outgoing";
 * sources without direction (PDFs, stammdaten, notes) are ignored.
 */
function isAwaitingReply(entityId: string, sinceIso: string | undefined): boolean {
  if (!sinceIso) return false;
  type Row = { direction: string | null; ingested_at: string };
  // Most recent OUTGOING email to this entity that landed at or after the
  // incident was first reported. If one exists, we're awaiting their reply.
  const out = db()
    .prepare(
      `SELECT direction, ingested_at FROM sources
        WHERE entity_id = @id
          AND direction = 'outgoing'
          AND ingested_at >= @since
        ORDER BY ingested_at DESC
        LIMIT 1`,
    )
    .get({ id: entityId, since: sinceIso }) as Row | undefined;
  if (!out) return false;
  // If a NEWER inbound landed after that outbound, we're back on the hook —
  // the tenant has already replied, the case isn't waiting on them anymore.
  const newerInbound = db()
    .prepare(
      `SELECT 1 AS x FROM sources
        WHERE entity_id = @id
          AND direction = 'incoming'
          AND ingested_at > @ts
        LIMIT 1`,
    )
    .get({ id: entityId, ts: out.ingested_at }) as { x: number } | undefined;
  return !newerInbound;
}

function findFactValue(entityId: string, predicate: string): string | undefined {
  const facts = getAllFactsForEntity(entityId).filter(f => f.known_to === null && f.predicate === predicate);
  return facts[0] ? String(facts[0].value) : undefined;
}

function incidentSeverity(type: string, status: string): Severity {
  if (status === "resolved") return "low";
  if (type === "water_damage" || type === "mold") return "critical";
  if (type === "lock_issue" || type === "elevator") return "high";
  if (type === "heating") return "medium";
  return "medium";
}

function incidentTitle(type: string): string {
  const titles: Record<string, string> = {
    water_damage: "Wasserschaden",
    mold: "Schimmelbefall",
    lock_issue: "Schloss / Tür defekt",
    heating: "Heizungsproblem",
    elevator: "Aufzugstörung",
    other: "Schadensmeldung",
  };
  return titles[type] ?? titles.other;
}

function incidentTitleEn(type: string): string {
  const titles: Record<string, string> = {
    water_damage: "Water damage",
    mold: "Mold",
    lock_issue: "Lock / door issue",
    heating: "Heating issue",
    elevator: "Elevator outage",
    other: "Damage report",
  };
  return titles[type] ?? titles.other;
}

function incidentSummary(type: string, entity: Entity, facts: Fact[]): string {
  const firstFact = facts[0];
  const quote = firstFact?.span?.quote?.slice(0, 120) ?? "";
  return `${incidentTitle(type)} gemeldet bei ${entity.name}. "${quote}"`;
}

function incidentSummaryEn(type: string, entity: Entity, facts: Fact[]): string {
  const firstFact = facts[0];
  const quote = firstFact?.span?.quote?.slice(0, 120) ?? "";
  return `${incidentTitleEn(type)} reported by ${entity.name}. "${quote}"`;
}

function findContractor(
  incidentType: string,
  contractors: Map<string, Entity>,
): { chosen: Entity; alternatives: Entity[] } | undefined {
  // Map incident types to contractor industries (Branche)
  // Order matters: specialists FIRST (most specific), generalists LAST.
  // Hausmeisterdienst is the fallback only when no specialist matches.
  const brancheMap: Record<string, string[]> = {
    lock_issue:   ["Schließanlage", "Schlüsseldienst", "Hausmeisterdienst"],
    water_damage: ["Sanitär", "Klempner", "Hausmeisterdienst"],
    mold:         ["Schimmelbeseitigung", "Sanitär", "Hausmeisterdienst"],
    heating:      ["Heizungswartung"],
    elevator:     ["Aufzugswartung"],
    other:        ["Hausmeisterdienst"],
  };
  const targetBranches = brancheMap[incidentType] ?? brancheMap.other;
  // Build matches with a specificity score: earlier in the trade list = more
  // specific (e.g. for lock_issue, "Schließanlage" is more specific than
  // "Hausmeisterdienst"). Specialists win over generalists, even if the
  // generalist has slightly higher reputation.
  const matches: Array<{ entity: Entity; specificity: number }> = [];
  for (const [, c] of contractors) {
    const branche = foldUmlauts((c.meta?.branche as string) ?? "");
    let bestSpecificity = -1;
    for (let i = 0; i < targetBranches.length; i++) {
      if (branche.includes(foldUmlauts(targetBranches[i]))) {
        // Index 0 → most specific. Score = N - i so high = more specific.
        const score = targetBranches.length - i;
        if (score > bestSpecificity) bestSpecificity = score;
      }
    }
    if (bestSpecificity > 0) matches.push({ entity: c, specificity: bestSpecificity });
  }
  if (matches.length === 0) return undefined;

  // Sort by specificity first, reputation second. So the most-specific trade
  // wins; among equally-specific contractors, reputation breaks the tie.
  const scored = matches.map((m) => ({ ...m, rep: getReputation(m.entity.id) }));
  scored.sort((a, b) => {
    if (b.specificity !== a.specificity) return b.specificity - a.specificity;
    return b.rep.score - a.rep.score;
  });
  return {
    chosen: scored[0].entity,
    alternatives: scored.slice(1).map((s) => s.entity),
  };
}

/**
 * Build a `reputation` annotation for a contractor action. If the *worst*
 * candidate considered was below "avoid", record it as the `avoided` field
 * so the UI can surface "we routed around X (score 0.0) → recommending Y".
 */
function annotateContractorReputation(
  action: RecommendedAction,
  chosen: Entity,
  alternatives: Entity[],
): void {
  if (action.type !== "dispatch_contractor") return;
  const rep = getReputation(chosen.id);
  let avoided: Reputation | null = null;
  // The "worst" alternative we passed over — only flag if it's notably worse
  // than what we picked (delta > 0.2) and below 0.4.
  for (const alt of alternatives) {
    const altRep = getReputation(alt.id);
    if (altRep.score < 0.4 && altRep.score < rep.score - 0.2) {
      if (!avoided || altRep.score < avoided.score) avoided = altRep;
    }
  }
  action.reputation = {
    score: rep.score,
    band: rep.band,
    incidents_open: rep.incidents_open,
    incidents_total: rep.incidents_total,
    mahnung_count: rep.mahnung_count,
    last_incident_at: rep.last_incident_at,
    avoided: avoided
      ? {
          entity_id: avoided.entity_id,
          name: chosenNameFor(avoided.entity_id, alternatives) ?? avoided.entity_id,
          score: avoided.score,
        }
      : undefined,
  };
}

function chosenNameFor(entityId: string, candidates: Entity[]): string | null {
  return candidates.find((c) => c.id === entityId)?.name ?? null;
}

function foldUmlauts(s: string): string {
  return s
    .toLowerCase()
    .replace(/ö/g, "oe")
    .replace(/ä/g, "ae")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}
