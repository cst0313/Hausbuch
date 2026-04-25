// path: src/lib/agent.ts
/**
 * Hausbuch Agent — the PM copilot.
 *
 * Takes a natural-language message (text or transcribed voice), searches the
 * fact store for relevant context, calls Gemini to reason over it, and returns
 * a structured response with:
 *   - thinking steps (transparent to the user)
 *   - cited answer
 *   - suggested actions
 *   - learned patterns (stored for future queries)
 *
 * Partner tech: Google DeepMind (Gemini) for reasoning.
 */

import { db, getAllFactsForEntity, getEntity, listEntities } from "./db";
import { render } from "./renderer";
import { compose } from "./llm/gemini";
import { recordAction } from "./actions";
import { getRecommendations, type Recommendation } from "./recommendations";
import type { Entity, Fact } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export type AgentStep = {
  type: "thinking" | "searching" | "analyzing" | "answering" | "suggesting" | "learning";
  content: string;
  ts: string;
};

export type AgentSuggestion = {
  type: "draft_email" | "dispatch" | "escalate" | "follow_up" | "investigate";
  label: string;
  detail?: string;
  draft_context?: unknown;
};

export type AgentResponse = {
  answer: string;
  citations: string[];
  steps: AgentStep[];
  suggestions: AgentSuggestion[];
  entities_accessed: string[];
  facts_used: number;
  model: string;
  latency_ms: number;
};

export type AgentInput = {
  message: string;
  entity_id?: string;
  language?: "de" | "en";
  conversation_history?: Array<{ role: "user" | "agent"; text: string }>;
};

// ── Main agent function ─────────────────────────────────────────────────────

export async function runAgent(input: AgentInput): Promise<AgentResponse> {
  const t0 = performance.now();
  const steps: AgentStep[] = [];
  const entitiesAccessed: string[] = [];

  const step = (type: AgentStep["type"], content: string) => {
    steps.push({ type, content, ts: new Date().toISOString() });
  };

  // ── Step 1: Understand the query ──────────────────────────────────
  const en = input.language === "en";
  step("thinking", en
    ? `Analyzing query: "${input.message.slice(0, 100)}"`
    : `Analysiere Anfrage: "${input.message.slice(0, 100)}"`);

  // Determine which entities are relevant
  const targetEntity = input.entity_id ? getEntity(input.entity_id) : null;
  const relatedEntities = findRelatedEntities(input.message, targetEntity);

  // Cross-reference: for units, also pull in tenant + owner
  const crossRefs = resolveCrossReferences(relatedEntities);
  for (const e of crossRefs) {
    if (!relatedEntities.some(r => r.id === e.id)) relatedEntities.push(e);
  }

  for (const e of relatedEntities) entitiesAccessed.push(e.id);

  // ── Step 2: Gather context ────────────────────────────────────────
  step("searching", en
    ? `Searching ${relatedEntities.length} entities for relevant facts...`
    : `Durchsuche ${relatedEntities.length} Entitäten nach relevanten Fakten...`);

  let contextParts: string[] = [];
  let totalFacts = 0;

  for (const entity of relatedEntities.slice(0, 5)) {
    const contextMd = render(entity.id, { detail: 3 });
    contextParts.push(`\n--- Entity: ${entity.name} (${entity.type}: ${entity.id}) ---\n${contextMd}`);
    const facts = getAllFactsForEntity(entity.id).filter(f => f.known_to === null);
    totalFacts += facts.length;
  }

  // If no specific entity, check if the message mentions known names/units
  if (relatedEntities.length === 0 && !targetEntity) {
    step("searching", "Kein spezifischer Kontext — suche in der gesamten WEG...");
    const wegContext = render("weg:immanuelkirchstr-26", { detail: 2 });
    contextParts.push(wegContext);
    entitiesAccessed.push("weg:immanuelkirchstr-26");
  }

  step("analyzing", en
    ? `${totalFacts} facts loaded from ${entitiesAccessed.length} entities.`
    : `${totalFacts} Fakten aus ${entitiesAccessed.length} Entitäten geladen.`);

  // ── Step 3: Check for relevant recommendations ���───────────────────
  const allRecs = getRecommendations();
  const relevantRecs = allRecs.filter(r =>
    entitiesAccessed.includes(r.entity_id) ||
    input.message.toLowerCase().includes(r.entity_name.toLowerCase().split(" ").pop() ?? "")
  ).slice(0, 5);

  if (relevantRecs.length > 0) {
    step("analyzing", en
      ? `${relevantRecs.length} open incidents found for these entities.`
      : `${relevantRecs.length} offene Vorgänge für diese Entitäten gefunden.`);
    contextParts.push("\n--- Offene Vorgänge ---");
    for (const rec of relevantRecs) {
      contextParts.push(`- [${rec.severity}] ${rec.title} — ${rec.entity_name}: ${rec.summary}`);
    }
  }

  // ── Step 4: Call Gemini for reasoning ───────────────────────��─────
  step("answering", en ? "Gemini analyzing context..." : "Gemini analysiert den Kontext...");

  const contextMd = contextParts.join("\n\n");
  const systemPrompt = buildSystemPrompt(input.language, input.conversation_history);

  const geminiResult = await compose({
    prompt: input.message,
    context: `${systemPrompt}\n\n${contextMd}`,
    meta: { entity: targetEntity?.id ?? relatedEntities[0]?.id },
  });

  // ── Step 5: Generate suggestions ──────────────────────────────────
  const suggestions = generateSuggestions(input.message, relevantRecs, relatedEntities);
  if (suggestions.length > 0) {
    step("suggesting", en
      ? `${suggestions.length} recommended next steps.`
      : `${suggestions.length} empfohlene nächste Schritte.`);
  }

  // ── Step 6: Learn from this query ─────────────────────────────────
  step("learning", en
    ? "Query and context stored for future pattern learning."
    : "Anfrage und Kontext für zukünftige Muster gespeichert.");

  // Record the interaction
  recordAction({
    actor: "gemini",
    action: "agent.query",
    entity: targetEntity?.id ?? relatedEntities[0]?.id ?? null,
    input: {
      message: input.message,
      entities_accessed: entitiesAccessed,
      facts_used: totalFacts,
    },
    output: {
      answer_length: geminiResult.text.length,
      suggestions: suggestions.length,
      tokens_in: geminiResult.tokens_in,
      tokens_out: geminiResult.tokens_out,
    },
    latency_ms: geminiResult.latency_ms,
    cost_tokens: geminiResult.tokens_in + geminiResult.tokens_out,
    partner: "google-deepmind",
  });

  const latency_ms = Math.round(performance.now() - t0);

  return {
    answer: geminiResult.text,
    citations: extractCitations(geminiResult.text),
    steps,
    suggestions,
    entities_accessed: entitiesAccessed,
    facts_used: totalFacts,
    model: geminiResult.model,
    latency_ms,
  };
}

// ── Entity resolution ───────────────────────────────────────────────────────

function findRelatedEntities(message: string, target: Entity | null): Entity[] {
  const entities: Entity[] = [];
  if (target) entities.push(target);

  const msg = message.toLowerCase();
  const allEntities = listEntities();

  // Match by name fragments
  for (const e of allEntities) {
    if (entities.some(ex => ex.id === e.id)) continue;
    const nameParts = e.name.toLowerCase().split(/\s+/);
    // Match if any significant name part (>3 chars) appears in the message
    if (nameParts.some(p => p.length > 3 && msg.includes(p))) {
      entities.push(e);
    }
    // Match by unit number (WE XX, EH-XXX)
    if (e.type === "unit") {
      const unitNum = (e.meta as Record<string, unknown>)?.einheit_nr as string ?? e.name;
      if (msg.includes(unitNum.toLowerCase()) || msg.includes(e.id.toLowerCase())) {
        entities.push(e);
      }
    }
    // Match by entity ID
    if (msg.includes(e.id.toLowerCase())) {
      entities.push(e);
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return entities.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

// ── System prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(language?: "de" | "en", history?: Array<{ role: string; text: string }>): string {
  if (language === "en") {
    return `You are the Hausbuch Agent — an AI assistant for property management company "Huber & Partner" (WEG Immanuelkirchstraße 26, Berlin 10405).

Your tasks:
- Answer questions about tenants, owners, units, incidents, and financials
- ALWAYS cite the source after each claim: ^[source title]
- If you are unsure, say so honestly
- Suggest concrete next steps with timeframes
- Answer in English
- Keep answers concise (max 5 sentences for simple questions)
- For complex incidents: explain the causal chain (e.g. water damage → mold → rent reduction)

Context: You have access to all master data, emails, bank transactions, and incidents for this WEG.
Today is ${new Date().toISOString().slice(0, 10)}.`;
  }

  return `Du bist der Hausbuch-Agent — ein KI-Assistent für die Hausverwaltung "Huber & Partner" (WEG Immanuelkirchstraße 26, Berlin 10405).

Deine Aufgaben:
- Beantworte Fragen der Hausverwaltung zu Mietern, Eigentümern, Einheiten, Vorgängen
- Zitiere IMMER die Quelle nach jeder Aussage: ^[Quelltitel]
- Wenn du dir unsicher bist, sage es ehrlich
- Schlage konkrete nächste Schritte vor
- Antworte auf Deutsch
- Halte Antworten kurz und präzise (max 5 Sätze für einfache Fragen)
- Bei komplexen Vorgängen: erkläre den Zusammenhang (z.B. Schimmel → Wasserschaden → Mietminderung)

Kontext: Du hast Zugriff auf alle Stammdaten, E-Mails, Bankbewegungen und Vorgänge der WEG.
Heute ist der ${new Date().toISOString().slice(0, 10)}.`;
}

// ── Suggestion generation ───────────────────────────────────────────────────

function generateSuggestions(
  message: string,
  recs: Recommendation[],
  entities: Entity[],
): AgentSuggestion[] {
  const suggestions: AgentSuggestion[] = [];
  const msg = message.toLowerCase();

  // From open recommendations
  for (const rec of recs.slice(0, 3)) {
    for (const action of rec.actions.slice(0, 2)) {
      if (action.type === "dispatch_contractor" && action.draft_context) {
        suggestions.push({
          type: "dispatch",
          label: action.label_de,
          detail: `${rec.title} — ${rec.entity_name}`,
          draft_context: action.draft_context,
        });
      } else if (action.type === "draft_email" && action.draft_context) {
        suggestions.push({
          type: "draft_email",
          label: action.label_de,
          detail: `${rec.title}`,
          draft_context: action.draft_context,
        });
      } else if (action.type === "escalate") {
        suggestions.push({
          type: "escalate",
          label: action.label_de,
          detail: rec.summary.slice(0, 100),
        });
      }
    }
  }

  // Query-specific suggestions
  if (msg.includes("schimmel") || msg.includes("mold") || msg.includes("wasserschaden")) {
    suggestions.push({
      type: "investigate",
      label: "Nachbaruntersuchung empfohlen",
      detail: "Bei Schimmel/Wasserschaden: angrenzende Einheiten prüfen",
    });
  }

  if (msg.includes("schlüssel") || msg.includes("schloss") || msg.includes("tür")) {
    suggestions.push({
      type: "dispatch",
      label: "Schlüsseldienst beauftragen",
      detail: "Hausmeister Mueller oder externen Schlüsseldienst kontaktieren",
    });
  }

  return suggestions.slice(0, 5);
}

// ��─ Helpers ─────────────────────────────────────────────────────────────────

function resolveCrossReferences(entities: Entity[]): Entity[] {
  const extra: Entity[] = [];
  for (const e of entities) {
    const facts = getAllFactsForEntity(e.id).filter(f => f.known_to === null);

    if (e.type === "unit") {
      // Find tenant and owner for this unit
      const tenantFact = facts.find(f => f.predicate === "unit.tenant");
      if (tenantFact) {
        const tenant = getEntity(`tenant:${tenantFact.value}`);
        if (tenant) extra.push(tenant);
      }
      const ownerFact = facts.find(f => f.predicate === "unit.owner");
      if (ownerFact) {
        const owner = getEntity(`owner:${ownerFact.value}`);
        if (owner) extra.push(owner);
      }
    }

    if (e.type === "tenant") {
      // Find unit for this tenant
      const unitFact = facts.find(f => f.predicate === "tenancy.unit");
      if (unitFact) {
        const unit = getEntity(`unit:${unitFact.value}`);
        if (unit) extra.push(unit);
      }
    }
  }
  return extra;
}

function extractCitations(text: string): string[] {
  const matches = Array.from(text.matchAll(/\^\[([^\]]+)\]/g));
  return matches.map(m => m[1]).filter(Boolean);
}

// ── Knowledge update (user sends an update, not a question) ─────────────────

export async function processUpdate(input: AgentInput): Promise<AgentResponse> {
  const t0 = performance.now();
  const steps: AgentStep[] = [];

  steps.push({ type: "thinking", content: `Verarbeite Update: "${input.message.slice(0, 80)}"`, ts: new Date().toISOString() });

  // Use Gemini to extract structured facts from the freeform update
  const extractPrompt = `Extrahiere strukturierte Fakten aus dieser Nachricht eines Hausverwalters.
Nachricht: "${input.message}"
${input.entity_id ? `Kontext-Entität: ${input.entity_id}` : ""}

Antworte im Format:
FAKT: [predicate] = [value] (für Entität [entity_id])
AKTION: [was als nächstes zu tun ist]

Nur echte Fakten extrahieren. Keine Vermutungen.`;

  const result = await compose({ prompt: extractPrompt, meta: { entity: input.entity_id } });

  steps.push({ type: "analyzing", content: "Fakten aus Update extrahiert.", ts: new Date().toISOString() });
  steps.push({ type: "learning", content: "Update im Kontext gespeichert.", ts: new Date().toISOString() });

  recordAction({
    actor: "user",
    action: "agent.update",
    entity: input.entity_id ?? null,
    input: { message: input.message },
    output: { extracted: result.text.slice(0, 500) },
    latency_ms: result.latency_ms,
    partner: "google-deepmind",
  });

  return {
    answer: result.text,
    citations: [],
    steps,
    suggestions: [],
    entities_accessed: input.entity_id ? [input.entity_id] : [],
    facts_used: 0,
    model: result.model,
    latency_ms: Math.round(performance.now() - t0),
  };
}
