// path: src/lib/drafter.ts
/**
 * Email drafter (Gemini-powered).
 *
 * Takes an incident context + recipient and generates a ready-to-send
 * German business email. One Gemini call per draft, ~1-3 seconds.
 *
 * Partner tech: Google DeepMind (Gemini) — counts toward the 3/7 requirement.
 */

import { compose } from "./llm/gemini";
import { recordAction } from "./actions";

export type DraftRequest = {
  from: string;
  to: string;
  to_email: string;
  subject: string;
  incident_summary: string;
  entity_context: string;
  language?: "de" | "en";
  tone?: "formal" | "urgent";
};

export type DraftResult = {
  subject: string;
  body: string;
  to: string;
  to_email: string;
  from: string;
  language: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  model: string;
};

export async function draftEmail(req: DraftRequest): Promise<DraftResult> {
  const lang = req.language ?? "de";
  const tone = req.tone ?? "formal";

  const prompt = lang === "de"
    ? `Schreibe eine professionelle E-Mail als Hausverwaltung.

Absender: ${req.from}
Empfänger: ${req.to} <${req.to_email}>
Betreff: ${req.subject}

Kontext: ${req.incident_summary}
Details: ${req.entity_context}

Ton: ${tone === "urgent" ? "Dringend, aber professionell" : "Höflich und sachlich"}
Format: Nur den E-Mail-Body, keine Header. Beginne mit "Sehr geehrte/r..." und ende mit "Mit freundlichen Grüßen, Huber & Partner Immobilienverwaltung GmbH".
Wichtig: Kurz (max 8 Sätze). Konkrete nächste Schritte nennen. Keine Floskeln.`
    : `Write a professional property management email.

From: ${req.from}
To: ${req.to} <${req.to_email}>
Subject: ${req.subject}

Context: ${req.incident_summary}
Details: ${req.entity_context}

Tone: ${tone === "urgent" ? "Urgent but professional" : "Polite and factual"}
Format: Body only, no headers. Start with "Dear..." and end with "Kind regards, Huber & Partner Immobilienverwaltung GmbH".
Important: Brief (max 8 sentences). Include concrete next steps. No filler.`;

  const result = await compose({ prompt });

  recordAction({
    actor: "gemini",
    action: "draft.email",
    entity: null,
    input: { to: req.to, subject: req.subject, language: lang },
    output: { body_length: result.text.length, tokens_out: result.tokens_out },
    latency_ms: result.latency_ms,
    cost_tokens: result.tokens_in + result.tokens_out,
    partner: "google-deepmind",
  });

  return {
    subject: req.subject,
    body: result.text,
    to: req.to,
    to_email: req.to_email,
    from: req.from,
    language: lang,
    tokens_in: result.tokens_in,
    tokens_out: result.tokens_out,
    latency_ms: result.latency_ms,
    model: result.model,
  };
}
