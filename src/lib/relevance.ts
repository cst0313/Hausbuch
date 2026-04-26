// path: src/lib/relevance.ts
/**
 * Signal vs noise filter — decide whether an extracted fact is actually about
 * the named entity, before we let it into the store.
 *
 * Buena track §3: "90% of emails are irrelevant. The engine must judge what
 * belongs in the context and what doesn't."
 *
 * This runs AFTER extraction but BEFORE write. The extractor may happily fire
 * a regex on any German rental text; the relevance gate asks "does this fact
 * actually pertain to property:berliner-str-42 or is the document talking
 * about a different building?"
 *
 * The gate is deliberately simple and explainable — an LLM would do better
 * but this runs in microseconds and is auditable from one function.
 */

import type { Source } from "./types";
import { getEntity, getAllFactsForEntity } from "./db";

export type RelevanceDecision = {
  accept: boolean;
  score: number;     // 0..1, higher = more relevant
  reasons: string[]; // human-readable explanation of the decision
};

/**
 * Decide whether to ingest a fact about `entity` given the `source` text.
 *
 * Positive signals (push score up):
 *   - The entity's human name appears verbatim in the source text
 *   - The source title already mentions the entity
 *   - The source kind is high-trust (legal, pdf, erp)
 *
 * Negative signals (push score down):
 *   - The source explicitly names a DIFFERENT entity (another address, building)
 *   - The source is casual-noise (auto-reply, out-of-office, marketing)
 *   - The source has no entity-anchor at all
 */
export function judgeRelevance(
  entity: string,
  source: Source,
  extractedCount: number,
): RelevanceDecision {
  const reasons: string[] = [];
  let score = 0.5;

  const text = source.raw_excerpt;
  const title = source.title;
  const entityTokens = tokensFromEntity(entity);

  // ── Positive: entity name appears in text ────────────────────────────
  // We also count indirect references like apartment numbers, so an email
  // about "Apt 3" isn't flagged as irrelevant.
  let entityHits = 0;
  for (const tok of entityTokens) {
    const re = new RegExp(`\\b${escapeRegex(tok)}\\b`, "i");
    if (re.test(text) || re.test(title)) {
      entityHits++;
    }
  }
  // Indirect anchors: "Apt N", "Wohnung N", "Unit N" — common in property docs
  const indirectAnchor = /\b(?:apt|apartment|wohnung|einheit|unit)\s*\d+\b/i.test(text);
  if (entityHits > 0) {
    score += 0.15 * Math.min(entityHits, 3);
    reasons.push(`entity matched ${entityHits}× (tokens: ${entityTokens.slice(0, 3).join(", ")})`);
  } else if (indirectAnchor) {
    score += 0.05;
    reasons.push("indirect anchor (apartment/unit number) present — treating as likely-related");
  } else {
    score -= 0.08;
    reasons.push("no direct or indirect entity anchor — weak relevance signal");
  }

  // ── Positive: extractor actually found something ─────────────────────
  if (extractedCount > 0) {
    score += 0.05 * Math.min(extractedCount, 4);
    reasons.push(`${extractedCount} fact${extractedCount === 1 ? "" : "s"} extracted`);
  }

  // ── Positive: source kind has inherent trust ────────────────────────
  const trustByKind: Record<string, number> = {
    legal: 0.15,
    pdf: 0.08,
    erp: 0.08,
    zendesk: 0.05,
    slack: 0.0,
    email: -0.03,
    note: -0.05,
    db: 0.05,
  };
  const trustDelta = trustByKind[source.kind] ?? 0;
  if (trustDelta !== 0) {
    score += trustDelta;
    reasons.push(
      `source kind "${source.kind}" ${trustDelta > 0 ? "trust bonus" : "trust penalty"} ${trustDelta.toFixed(2)}`,
    );
  }

  // ── Negative: noise patterns common in email corpora ─────────────────
  const noisePatterns: Array<[RegExp, number, string]> = [
    [/\bout\s+of\s+office\b/i, -0.4, "out-of-office auto-reply"],
    [/\bautomatic\s+reply\b/i, -0.4, "automatic reply"],
    [/\babwesenheit\b/i, -0.4, "Abwesenheitsnotiz"],
    [/\bunsubscribe\b/i, -0.3, "newsletter unsubscribe"],
    [/\babmelden\b/i, -0.3, "newsletter Abmelden"],
    [/\bspecial\s+offer\b/i, -0.3, "marketing / promotional"],
    [/\bjahressonderangebot\b/i, -0.3, "marketing / promotional"],
  ];
  for (const [re, delta, label] of noisePatterns) {
    if (re.test(text)) {
      score += delta;
      reasons.push(`noise pattern detected: ${label}`);
    }
  }

  // ── Negative: conflicting address / building explicitly named ───────
  const conflictingAddress = detectConflictingAddress(text, entityTokens);
  if (conflictingAddress) {
    score -= 0.4;
    reasons.push(`different property mentioned: "${conflictingAddress}"`);
  }

  // Clamp 0..1
  score = Math.max(0, Math.min(1, score));

  // Threshold: we accept anything >= 0.30. Lowered from 0.35 after observing
  // that legitimate business docs (landlord emails, renewal letters) often
  // don't mention the entity name directly — they reference apartment
  // numbers or assume context from the recipient. Noise patterns still
  // fire hard negative deltas, so spam stays below the line.
  const accept = score >= 0.30;
  reasons.unshift(accept ? `ACCEPT · score=${score.toFixed(2)}` : `REJECT · score=${score.toFixed(2)}`);

  return { accept, score, reasons };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

function tokensFromEntity(entity: string): string[] {
  // Entity IDs are often opaque slugs ("contractor:DL-010") that never appear
  // in document text. The relevance signal comes from the human name + key
  // identity facts (firma, email) — those are what actual letters / invoices
  // reference. Fall back to the slug only when nothing better is available.
  const out = new Set<string>();

  const ent = (() => { try { return getEntity(entity); } catch { return null; } })();
  if (ent?.name) {
    const cleaned = ent.name.toLowerCase().trim();
    out.add(cleaned);
    // Salutations like "Frau " / "Herr " shouldn't anchor relevance — strip them
    // so the token is the actual person/firma name.
    const stripped = cleaned.replace(/^\s*(frau|herr|firma|kanzlei)\s+/i, "");
    if (stripped !== cleaned) out.add(stripped);
    // Individual words ≥ 4 chars are useful for partial matches.
    for (const w of stripped.split(/[\s.,&-]+/)) {
      if (w.length >= 4) out.add(w);
    }
  }

  // Pull identity facts — firma / email / address localpart all show up in
  // documents about the entity.
  try {
    const facts = getAllFactsForEntity(entity).filter((f) => f.known_to === null);
    for (const f of facts) {
      if (
        f.predicate === "identity.firma" ||
        f.predicate === "identity.name" ||
        f.predicate === "identity.email"
      ) {
        const v = String(f.value ?? "").toLowerCase().trim();
        if (!v) continue;
        if (f.predicate === "identity.email") {
          // Just the local part — recipients often write "max@example.com" but
          // body text rarely repeats the address verbatim.
          const local = v.split("@")[0];
          if (local && local.length >= 4) out.add(local);
        } else {
          out.add(v);
          for (const w of v.split(/[\s.,&-]+/)) {
            if (w.length >= 4) out.add(w);
          }
        }
      }
    }
  } catch {
    /* ignore — entity might be transient */
  }

  // Slug fallback if we got nothing else.
  if (out.size === 0) {
    const tail = entity.split(":").pop() ?? entity;
    for (const w of tail.split(/[-_]/)) if (w.length > 1) out.add(w);
  }

  return Array.from(out);
}

function detectConflictingAddress(text: string, entityTokens: string[]): string | null {
  // Look for "street-like" patterns in text that don't overlap with entity tokens.
  // Conservative: only flag if we find a strong non-overlapping address.
  const addressPatterns = [
    /\b([A-ZÄÖÜ][a-zäöüß]+(?:er|-)?\s*(?:Straße|Str\.?|Allee|Weg|Platz|Gasse|Damm)\s*\d+)/g,
    /\b(\d+\s+[A-Z][a-z]+\s+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?))/g,
  ];
  const found: string[] = [];
  for (const re of addressPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      found.push(m[1]);
    }
  }
  if (found.length === 0) return null;

  // Does any address overlap with entity tokens?
  const ent = entityTokens.map((t) => t.toLowerCase());
  for (const addr of found) {
    const addrLower = addr.toLowerCase();
    const overlaps = ent.some((tok) => addrLower.includes(tok));
    if (!overlaps) return addr;
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
