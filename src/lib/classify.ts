// path: src/lib/classify.ts
/**
 * LLM fallback for email incident classification.
 *
 * The keyword scorer in seed.ts handles ~95% of incident emails. For the long
 * tail — paraphrased descriptions, English, novel idioms — we ask Gemini to
 * pick a type from a closed vocabulary. Gated on category=Schaden/Mangel so
 * the historical 6,500-email backlog (no index → no category) doesn't trigger
 * an LLM call per row.
 */

import { compose } from "./llm/gemini";

export const INCIDENT_TYPES = [
  "water_damage",
  "mold",
  "heating",
  "lock_issue",
  "elevator",
  "noise",
  "electrical",
  "pest",
  "garbage",
  "other",
] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number];

const PROMPT = `You are a property-management triage classifier. Given a tenant email, pick the SINGLE incident type from this closed list:

water_damage  — leaks, flooding, dripping pipes, wet walls
mold          — Schimmel, mildew, fungal growth
heating       — Heizung defect, no warm water, cold radiator
lock_issue    — broken lock, lost keys, door won't close
elevator      — Aufzug/Fahrstuhl defect
noise         — Lärm, Ruhestörung
electrical    — power outage, broken outlet, light fixtures
pest          — Schädlinge, mice, rats, cockroaches
garbage       — Müll, overflowing bins, missed pickup
other         — anything not above

Output exactly one word from the list. No explanation.`;

export async function classifyEmailIncident(
  subject: string,
  body: string,
): Promise<IncidentType | null> {
  try {
    const result = await compose({
      prompt: `Subject: ${subject}\n\nBody:\n${body.slice(0, 1500)}`,
      context: PROMPT,
    });
    const word = result.text.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z_]/g, "");
    if (!word) return null;
    if ((INCIDENT_TYPES as readonly string[]).includes(word)) {
      return word as IncidentType;
    }
    return null;
  } catch {
    return null;
  }
}
