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

// ── Types ───────────────────────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "low";

export type RecommendedAction = {
  type: "dispatch_contractor" | "draft_email" | "escalate" | "follow_up" | "review";
  label: string;
  label_de: string;
  recipient?: { entity_id: string; name: string; email?: string; role: string };
  draft_context?: DraftContext;
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
  title: string;
  summary: string;
  facts: Array<{ predicate: string; value: string; source_title: string; known_from: string }>;
  email_chain: Array<{ source_id: string; title: string; from: string; date: string; excerpt: string }>;
  actions: RecommendedAction[];
  created_at: string;
};

// ── Main entry ──────────────────────────────────────────────────────────────

export function getRecommendations(): Recommendation[] {
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
  return recs.filter(r => {
    const key = `${r.entity_id}:${r.category}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Incident grouping ───────────────────────────────────────────────────────

type IncidentGroup = {
  type: string;
  status: string;
  facts: Fact[];
};

function groupIncidents(facts: Fact[]): IncidentGroup[] {
  const byType = new Map<string, Fact[]>();
  for (const f of facts) {
    if (f.predicate === "incident.type") {
      const t = String(f.value);
      byType.set(t, [...(byType.get(t) ?? []), f]);
    }
  }

  const groups: IncidentGroup[] = [];
  for (const [type, typeFacts] of byType) {
    const statusFact = facts.find(f => f.predicate === "incident.status");
    groups.push({
      type,
      status: statusFact ? String(statusFact.value) : "reported",
      facts: [...typeFacts, ...facts.filter(f => f.predicate !== "incident.type" && f.predicate !== "communication.email")],
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
  const title = incidentTitle(incident.type);
  const summary = incidentSummary(incident.type, entity, incident.facts);

  // Find the right contractor for this incident type
  const contractor = findContractor(incident.type, contractors);

  const actions: RecommendedAction[] = [];

  if (incident.status === "reported") {
    // Need to dispatch a contractor
    if (contractor) {
      const contractorEmail = contractor.meta?.email as string ?? findFactValue(contractor.id, "identity.email") ?? "";
      actions.push({
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
      });
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
    summary,
    facts: factDetails,
    email_chain: emailChain.slice(0, 5),
    actions,
    created_at: incident.facts[0]?.known_from ?? new Date().toISOString(),
  };
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

    return {
      id: `rec:${entity.id}:mietminderung`,
      severity: "critical",
      entity_id: entity.id,
      entity_name: entity.name,
      entity_type: entity.type,
      category: "legal.mietminderung",
      title: `Mietminderung ${pct}% angekündigt`,
      summary: `${entity.name} hat eine Mietminderung um ${pct}% angekündigt. Rechtliche Prüfung und Mangelbehebung erforderlich.`,
      facts: [{
        predicate: fact.predicate,
        value: `${pct}% Minderung`,
        source_title: src?.title ?? fact.source,
        known_from: fact.known_from,
      }],
      email_chain: emailChain.slice(0, 5),
      actions: [
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
    return {
      id: `rec:${entity.id}:kuendigung`,
      severity: "high",
      entity_id: entity.id,
      entity_name: entity.name,
      entity_type: entity.type,
      category: "legal.kuendigung",
      title: "Kündigung eingegangen",
      summary: `${entity.name} hat den Mietvertrag gekündigt. Übergabetermin und Nachmietersuche einleiten.`,
      facts: [{
        predicate: fact.predicate,
        value: "Kündigung",
        source_title: src?.title ?? fact.source,
        known_from: fact.known_from,
      }],
      email_chain: emailChain.slice(0, 5),
      actions: [
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

function incidentSummary(type: string, entity: Entity, facts: Fact[]): string {
  const firstFact = facts[0];
  const quote = firstFact?.span?.quote?.slice(0, 120) ?? "";
  return `${incidentTitle(type)} gemeldet bei ${entity.name}. "${quote}"`;
}

function findContractor(incidentType: string, contractors: Map<string, Entity>): Entity | undefined {
  // Map incident types to contractor industries (Branche)
  const brancheMap: Record<string, string[]> = {
    lock_issue: ["Hausmeisterdienst", "Schlüsseldienst"],
    water_damage: ["Sanitär", "Hausmeisterdienst", "Klempner"],
    mold: ["Sanitär", "Schimmelbeseitigung", "Hausmeisterdienst"],
    heating: ["Heizungswartung"],
    elevator: ["Aufzugswartung"],
    other: ["Hausmeisterdienst"],
  };
  const targetBranches = brancheMap[incidentType] ?? brancheMap.other;
  for (const [, c] of contractors) {
    const branche = (c.meta?.branche as string) ?? "";
    if (targetBranches.some(b => branche.toLowerCase().includes(b.toLowerCase()))) {
      return c;
    }
  }
  return undefined;
}
