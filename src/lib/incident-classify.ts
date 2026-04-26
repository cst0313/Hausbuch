// path: src/lib/incident-classify.ts
/**
 * Single source of truth for incident keyword classification.
 *
 * Used by:
 *   - src/lib/seed.ts — at ingest, to write incident.type facts
 *   - src/lib/recommendations.ts — at rec build, to detect root causes
 *     mentioned in legal-fact source bodies (Mietminderung citing
 *     Wasserschaden + Schimmel, Kündigung citing Heizungsausfall, etc.)
 *
 * Keeping these patterns in ONE place avoids the failure mode where the
 * extractor and the rec engine independently learn what counts as a "water
 * damage email" and silently disagree.
 */

export type IncidentType =
  | "water_damage"
  | "mold"
  | "heating"
  | "lock_issue"
  | "elevator"
  | "noise"
  | "electrical"
  | "pest";

export const INCIDENT_PATTERNS: Array<[IncidentType, RegExp[]]> = [
  [
    "water_damage",
    [
      /\bwasser\b/i,
      /\bwasserschaden\b/i,
      /\bfeucht/i,
      /\bn(?:a|ä)sse\b/i,
      /\bnass\b/i,
      /\bdurchn(?:a|ä)sst/i,
      /\btropf/i,
      /\bleck/i,
      /\bleckage/i,
      /\bundicht/i,
      /\brohrbruch/i,
      /\bwasserrohr/i,
      /\b(?:ü|ue)berschw(?:emm|emm)/i,
      /\bdecke[^.]*?(?:tropf|nass|undicht|wasser)/i,
      /\bwater\b/i,
      /\bleak/i,
      /\bflood/i,
    ],
  ],
  ["mold", [/\bschimmel/i, /\bschimmelbefall/i, /\bmold\b/i, /\bmildew/i]],
  [
    "heating",
    [
      /\bheizung/i,
      /\bthermostat/i,
      /\bkalt[^.]{0,30}wohn/i,
      /\bheating\b/i,
      /\bboiler/i,
      /\bwarmwasser/i,
    ],
  ],
  [
    "lock_issue",
    [
      /\bschloss/i,
      /\bschl(?:ü|ue)ssel/i,
      /\btuer.*schliesst/i,
      /\bhaustuer/i,
      /\bschlie(?:ß|ss)anlage/i,
      /\block\b/i,
      /\bkey\b/i,
    ],
  ],
  ["elevator", [/\baufzug/i, /\belevator/i, /\bfahrstuhl/i, /\blift\b/i]],
  ["noise", [/\bruhest(?:ö|oe)rung/i, /\bl(?:ä|ae)rm\b/i, /\bnoise\b/i]],
  ["electrical", [/\bstromausfall/i, /\bsteckdose/i, /\belektr/i, /\bsicherung\b/i]],
  ["pest", [/\bsch(?:ä|ae)dling/i, /\bmaus|m(?:ä|ae)use\b/i, /\bratte/i, /\bschabe/i, /\bkakerlak/i]],
];

export type IncidentMatch = {
  type: IncidentType;
  /** Total regex hits across body+title. Higher = stronger signal. */
  score: number;
  /** True iff at least one match landed in the subject line. Subject hits are
   *  intentional; body mentions can be off-hand. */
  subjectMatch: boolean;
};

/**
 * Score every incident type against the given text. Returns only types with
 * at least one match, sorted by score descending.
 *
 * Pass `subject` separately so the caller can later weight subject hits
 * higher than body hits (the seed extractor uses subject-priority to break
 * ties; the rec engine uses subject-presence to filter "real cause"
 * mentions vs casual references).
 */
export function scoreIncidentTypes(body: string, subject: string): IncidentMatch[] {
  const text = `${body} ${subject}`.toLowerCase();
  const subj = subject.toLowerCase();
  return INCIDENT_PATTERNS.map(([type, regs]) => {
    let score = 0;
    let subjectMatch = false;
    for (const r of regs) {
      if (r.test(text)) score++;
      if (r.test(subj)) subjectMatch = true;
    }
    return { type, score, subjectMatch };
  })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * "Strong signal" gate used by the seed extractor: subject keyword OR
 * ≥2 body hits OR an explicit Schaden/Mangel category. Lifted out so the
 * rec engine can reuse the same threshold logic when deciding which
 * underlying mentions are real root causes.
 */
export function hasStrongIncidentSignal(
  matches: IncidentMatch[],
  hasSchadenCategory: boolean,
): boolean {
  if (hasSchadenCategory) return true;
  if (matches.some((m) => m.subjectMatch)) return true;
  if (matches[0] && matches[0].score >= 2) return true;
  return false;
}

/**
 * Maps incident types to the contractor branche(s) that handle them.
 * Specialists first (most specific), generalists last as fallback.
 * Single source of truth for src/lib/recommendations.ts dispatch routing.
 */
export const INCIDENT_TO_BRANCHE: Record<IncidentType, string[]> = {
  lock_issue: ["Schließanlage", "Schlüsseldienst", "Hausmeisterdienst"],
  water_damage: ["Sanitär", "Klempner", "Hausmeisterdienst"],
  mold: ["Schimmelbeseitigung", "Sanitär", "Hausmeisterdienst"],
  heating: ["Heizungswartung"],
  elevator: ["Aufzugswartung"],
  noise: ["Hausmeisterdienst"],
  electrical: ["Elektriker", "Hausmeisterdienst"],
  pest: ["Schädlingsbekämpfung", "Hausmeisterdienst"],
};
