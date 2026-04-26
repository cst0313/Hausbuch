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

import {
  db,
  getAllFactsForEntity,
  getEntity,
  listEntities,
  insertFact,
  insertSource,
  ident,
  newFactId,
  newSourceId,
  logEvent,
} from "./db";
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
  /** ID of the recommendation this suggestion belongs to. The CmdK
   *  client uses it to deep-link into the dashboard's StreamPanel
   *  (/dashboard?focus=<rec_id>) instead of re-asking the agent. */
  rec_id?: string;
  /** Fallback navigation target when no rec is in play. */
  entity_id?: string;
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

  const contextParts: string[] = [];
  let totalFacts = 0;
  const MAX_CHARS_PER_ENTITY = 24_000; // ~6K tokens — keeps LLM latency under 2s
  const TOTAL_BUDGET = 80_000;          // ~20K tokens across all entities
  let usedChars = 0;

  for (const entity of relatedEntities.slice(0, 5)) {
    if (usedChars > TOTAL_BUDGET) break;
    // Detail tiering: the FIRST entity gets full detail (3) so the agent can
    // reach for citations and the conflict math. Secondary entities drop to
    // detail=1 — compact mode, no anchored fact wrappers, no Recent activity,
    // no Upcoming. Saves ~85–95% of tokens per secondary entity vs the old
    // detail=2 with no behavior loss for the agent (it uses secondary entities
    // for cross-reference, not surgical edits).
    const detail = contextParts.length === 0 ? 3 : 1;
    let contextMd = render(entity.id, { detail });
    if (contextMd.length > MAX_CHARS_PER_ENTITY) {
      contextMd = contextMd.slice(0, MAX_CHARS_PER_ENTITY) + "\n…(truncated)\n";
    }
    contextParts.push(`\n--- Entity: ${entity.name} (${entity.type}: ${entity.id}) ---\n${contextMd}`);
    usedChars += contextMd.length;
    // Count facts cheaply from the rendered trailer instead of re-fetching.
    const trailer = contextMd.match(/Hausbuch · (\d+) facts/);
    totalFacts += trailer ? Number(trailer[1]) : 0;
  }

  // If no specific entity, surface a compact WEG snapshot — detail=1 keeps
  // it under ~6KB (1.5K tokens) instead of the 196KB full render. Was
  // already detail=1 — the optimization that made detail=1 actually do work
  // is what brought this from 49K tokens → 1.5K tokens.
  if (relatedEntities.length === 0 && !targetEntity) {
    step("searching", "No specific match — using WEG-level summary");
    let wegContext = render("weg:immanuelkirchstr-26", { detail: 1 });
    if (wegContext.length > MAX_CHARS_PER_ENTITY) {
      wegContext = wegContext.slice(0, MAX_CHARS_PER_ENTITY) + "\n…(truncated)\n";
    }
    contextParts.push(wegContext);
    entitiesAccessed.push("weg:immanuelkirchstr-26");
  }

  step("analyzing", en
    ? `${totalFacts} facts loaded from ${entitiesAccessed.length} entities.`
    : `${totalFacts} Fakten aus ${entitiesAccessed.length} Entitäten geladen.`);

  // ── Step 3: Check for relevant recommendations ���───────────────────
  // The previous filter ("entity loaded OR last-name appears in message")
  // pulled in 7 unrelated recs whenever the question mentioned the tenant —
  // asking about Magrit's rent surfaced her mold + lock + heating cases.
  // The new rule scores each rec's TOPIC against the question and only
  // keeps recs whose topic the question is plausibly about.
  const allRecs = getRecommendations();
  const queryKind = classifyQuery(input.message);
  const relevantRecs = filterRelevantRecs(allRecs, input.message, entitiesAccessed, queryKind);

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
  // Suggestions follow the same relevance gate as the rec list — if the
  // question wasn't about a topic the rec engine can act on, we surface
  // nothing rather than a confusing "Schlüsseldienst beauftragen" on a
  // rent-balance question.
  const suggestions = generateSuggestions(relevantRecs, queryKind);
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

/**
 * Three classes of question, each with a different suggestion policy:
 *
 *   informational  → "what is X / who is X / how much / wann ist"
 *                    Pure lookups. Suggestions are noise; surface nothing.
 *
 *   actionable     → "send / draft / dispatch / escalate / Antwort schicken"
 *                    The user wants to DO something. Surface up to 3
 *                    suggestions from the relevant recs.
 *
 *   queue          → "what's open / critical / pending / kritisch / offen"
 *                    Triage view. Surface up to 5 ranked suggestions.
 *
 *   ambiguous      → none of the above. Default-empty unless a rec scores
 *                    very high on topic overlap with the question.
 */
type QueryKind = "informational" | "actionable" | "queue" | "ambiguous";

function classifyQuery(message: string): QueryKind {
  const m = message.toLowerCase();

  // Action verbs — German + English. If present, the user wants to act.
  if (/\b(send|dispatch|draft|schedule|escalate|reply|respond|fix|reparier|beauftrag|drafte|schick|antwort|sende|verfasse|eskalier)\w*\b/.test(m)) {
    return "actionable";
  }

  // Queue / triage verbs.
  if (/\b(open|critical|pending|attention|priorit|today|offen|kritisch|prior|heute|dringend|akut|backlog|inbox|queue)\w*\b/.test(m)) {
    return "queue";
  }

  // Pure information requests.
  if (/^\s*(what|who|when|where|how much|how many|which|why|is|are|wer|was|wann|wo|wieviel|wie viel|wieviele|wie viele|ist|sind|welche)\b/.test(m)) {
    return "informational";
  }

  return "ambiguous";
}

/**
 * Topic keywords per rec category. If the question mentions any of these,
 * the rec is on-topic. Drives both the rec list and the suggestions.
 */
const TOPIC_KEYWORDS: Record<string, RegExp> = {
  "incident.water_damage": /\b(wasser|wasserschaden|leck|tropf|rohrbruch|feucht|nasse?|durchnässt|water|leak|flood)\w*\b/i,
  "incident.mold": /\b(schimmel|mold|mildew)\w*\b/i,
  "incident.heating": /\b(heizung|thermostat|kalt|warmwasser|boiler|heating)\w*\b/i,
  "incident.lock_issue": /\b(schloss|schlüssel|schluessel|tür|tuer|haustür|haustuer|schließanlage|lock|key)\w*\b/i,
  "incident.elevator": /\b(aufzug|fahrstuhl|lift|elevator)\w*\b/i,
  "incident.noise": /\b(lärm|laerm|ruhestörung|ruhestoerung|noise)\w*\b/i,
  "incident.electrical": /\b(strom|steckdose|elektr|sicherung|stromausfall)\w*\b/i,
  "legal.mietminderung": /\b(mietminderung|minderung|miete\s+minder|rent\s+reduction)\w*\b/i,
  "legal.kuendigung": /\b(kündigung|kuendigung|termination|terminat|move[\s-]?out|auszug)\w*\b/i,
};

/**
 * Filter recs strictly by topic + entity relevance. Pure entity overlap
 * (the rec mentions an entity we loaded) is NOT enough — that pulled in
 * a tenant's full backlog of unrelated cases on every rent question.
 */
function filterRelevantRecs(
  allRecs: Recommendation[],
  message: string,
  entitiesAccessed: string[],
  kind: QueryKind,
): Recommendation[] {
  if (kind === "informational") return [];
  // Queue/triage: return all open recs ranked by severity, no topic filter.
  if (kind === "queue") {
    const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...allRecs]
      .sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity])
      .slice(0, 5);
  }

  // Actionable / ambiguous: require BOTH topic and entity match.
  const m = message.toLowerCase();
  const scored = allRecs.map((r) => {
    const topicRe = TOPIC_KEYWORDS[r.category];
    const topicMatch = topicRe ? topicRe.test(m) : false;
    const entityMatch = entitiesAccessed.includes(r.entity_id);
    let score = 0;
    if (topicMatch) score += 5;
    if (entityMatch) score += 2;
    // Ambiguous queries need stronger evidence — actionable can act on a
    // single signal (e.g. "send the Mietminderung reply" with just the
    // category word).
    return { rec: r, score };
  });

  const threshold = kind === "actionable" ? 3 : 5;
  return scored
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.rec)
    .slice(0, 5);
}

function generateSuggestions(
  recs: Recommendation[],
  kind: QueryKind,
): AgentSuggestion[] {
  // No relevant recs → no suggestions. The point: never recommend an
  // action that doesn't fit the question. Empty is a valid answer.
  if (recs.length === 0) return [];
  // Informational queries already filtered to [] in filterRelevantRecs;
  // belt-and-braces here in case a future caller hands us recs anyway.
  if (kind === "informational") return [];

  const suggestions: AgentSuggestion[] = [];
  const cap = kind === "queue" ? 5 : 3;

  for (const rec of recs.slice(0, cap)) {
    // One suggestion per rec — pick the highest-leverage action available.
    const action =
      rec.actions.find((a) => a.type === "draft_email" && a.draft_context) ??
      rec.actions.find((a) => a.type === "dispatch_contractor" && a.draft_context) ??
      rec.actions.find((a) => a.type === "escalate") ??
      rec.actions[0];
    if (!action) continue;

    if (action.type === "dispatch_contractor" && action.draft_context) {
      suggestions.push({
        type: "dispatch",
        label: action.label_de,
        detail: `${rec.title} — ${rec.entity_name}`,
        draft_context: action.draft_context,
        rec_id: rec.id,
        entity_id: rec.entity_id,
      });
    } else if (action.type === "draft_email" && action.draft_context) {
      suggestions.push({
        type: "draft_email",
        label: action.label_de,
        detail: rec.title,
        draft_context: action.draft_context,
        rec_id: rec.id,
        entity_id: rec.entity_id,
      });
    } else if (action.type === "escalate") {
      suggestions.push({
        type: "escalate",
        label: action.label_de,
        detail: rec.summary.slice(0, 100),
        rec_id: rec.id,
        entity_id: rec.entity_id,
      });
    } else if (action.type === "follow_up") {
      suggestions.push({
        type: "follow_up",
        label: action.label_de,
        detail: rec.title,
        rec_id: rec.id,
        entity_id: rec.entity_id,
      });
    }
  }

  return suggestions.slice(0, cap);
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

/**
 * Process a freeform update from the manager and ACTUALLY edit the fact
 * store. The previous version only echoed Gemini's extraction; now we:
 *   1. Resolve the target entity from the message (or input.entity_id)
 *   2. Ask Gemini for a structured patch: predicate, value, valid_from
 *   3. Write the fact + a synthetic Source row so the change is auditable
 *
 * Bitemporal semantics: each new fact gets its own ident, so prior facts
 * with the same (entity, predicate) are superseded automatically by the
 * existing reconciliation pass. "Tenant moved out today" becomes a
 * tenancy.end fact with valid_from=today, which closes the active tenancy
 * cleanly without rewriting history.
 */
export async function processUpdate(input: AgentInput): Promise<AgentResponse> {
  const t0 = performance.now();
  const steps: AgentStep[] = [];

  steps.push({
    type: "thinking",
    content: `Verarbeite Update: "${input.message.slice(0, 80)}"`,
    ts: new Date().toISOString(),
  });

  // ── 1. Resolve target entity ────────────────────────────────────────
  const targetEntity = input.entity_id ? getEntity(input.entity_id) : null;
  const candidates = findRelatedEntities(input.message, targetEntity);
  const resolved = candidates[0] ?? targetEntity;

  if (!resolved) {
    return {
      answer: "Konnte die Entität in der Nachricht nicht eindeutig identifizieren. Bitte Name oder ID nennen.",
      citations: [],
      steps,
      suggestions: [],
      entities_accessed: [],
      facts_used: 0,
      model: "no-llm",
      latency_ms: Math.round(performance.now() - t0),
    };
  }
  steps.push({
    type: "searching",
    content: `Entität aufgelöst: ${resolved.name} (${resolved.id})`,
    ts: new Date().toISOString(),
  });

  // ── 2. Ask Gemini for a structured patch ────────────────────────────
  // JSON-mode output forces a parseable response. The closed predicate
  // vocabulary keeps the agent from inventing schema.
  const today = new Date().toISOString().slice(0, 10);
  const extractPrompt = `You convert a property manager's freeform update into ONE structured fact patch.

Today: ${today}
Target entity: ${resolved.id} (${resolved.type}: ${resolved.name})
Update: "${input.message}"

Pick ONE predicate from this closed list, based on what the update means:
  - tenancy.end           — tenant has moved out / lease ended (value = ISO date)
  - tenancy.start         — new tenancy begins (value = ISO date)
  - unit.tenant           — change of tenant assignment (value = tenant id or name)
  - identity.email        — corrected/new email address (value = email)
  - identity.telefon      — corrected/new phone number (value = phone)
  - incident.status       — incident progress (value = reported|in_progress|resolved)
  - notes.freeform        — anything that doesn't fit the above (value = the raw note)

Convert relative dates ("today", "next Monday") to ISO using ${today} as anchor.

Output ONLY a JSON object, no prose:
{
  "predicate": "<one of the list above>",
  "value": "<the value>",
  "valid_from": "<YYYY-MM-DD or null>",
  "human_summary": "<one short German sentence describing the change>"
}`;

  const result = await compose({
    prompt: extractPrompt,
    meta: { entity: resolved.id },
  });

  let patch: { predicate: string; value: string; valid_from: string | null; human_summary: string } | null = null;
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) patch = JSON.parse(jsonMatch[0]);
  } catch {
    // fall through — patch stays null
  }

  if (!patch || !patch.predicate || patch.value === undefined) {
    steps.push({
      type: "analyzing",
      content: "Konnte kein strukturiertes Faktum extrahieren.",
      ts: new Date().toISOString(),
    });
    return {
      answer: `Update verstanden, aber nicht strukturierbar.\n\nGemini hat geantwortet:\n${result.text}`,
      citations: [],
      steps,
      suggestions: [],
      entities_accessed: [resolved.id],
      facts_used: 0,
      model: result.model,
      latency_ms: Math.round(performance.now() - t0),
    };
  }

  steps.push({
    type: "analyzing",
    content: `Patch: ${patch.predicate} = ${patch.value}${patch.valid_from ? ` (gültig ab ${patch.valid_from})` : ""}`,
    ts: new Date().toISOString(),
  });

  // ── 3. Write the fact + a manager-update Source row ────────────────
  const now = new Date().toISOString();
  const sourceId = newSourceId(`manager-update-${resolved.id}`);
  insertSource({
    id: sourceId,
    kind: "stammdaten", // manager-typed updates use the highest-trust kind
    title: `Manager update: ${patch.human_summary ?? input.message.slice(0, 80)}`,
    ingested_at: now,
    raw_excerpt: input.message,
    source_prior: 0.98, // explicit human update outranks email-derived facts
    entity_id: resolved.id,
  });

  const factId = newFactId();
  const fact: Fact = {
    id: factId,
    entity: resolved.id,
    predicate: patch.predicate,
    value: patch.value,
    unit: undefined,
    valid_from: patch.valid_from ?? null,
    valid_to: null,
    known_from: now,
    known_to: null,
    source: sourceId,
    span: { start: 0, end: input.message.length, quote: input.message.slice(0, 200) },
    confidence: 0.99,
    superseded_by: null,
    ident: ident(resolved.id, patch.predicate, patch.valid_from ?? null),
  };
  insertFact(fact);
  logEvent("insert", factId, `agent.update · ${patch.predicate}`);

  steps.push({
    type: "learning",
    content: `Fakt geschrieben: ${patch.predicate} (Source: ${sourceId})`,
    ts: new Date().toISOString(),
  });

  recordAction({
    actor: "user",
    action: "agent.update",
    entity: resolved.id,
    input: { message: input.message },
    output: { predicate: patch.predicate, value: patch.value, valid_from: patch.valid_from, fact_id: factId },
    latency_ms: result.latency_ms,
    partner: "google-deepmind",
  });

  const summary = patch.human_summary ?? `${patch.predicate} = ${patch.value}`;
  return {
    answer: `${summary}\n\nKontext für ${resolved.name} aktualisiert. ^[Manager update]`,
    citations: [`Manager update: ${patch.human_summary ?? ""}`],
    steps,
    suggestions: [],
    entities_accessed: [resolved.id],
    facts_used: 1,
    model: result.model,
    latency_ms: Math.round(performance.now() - t0),
  };
}
