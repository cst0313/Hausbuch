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

  const urgentDe = tone === "urgent"
    ? "DRINGEND. Der Mangel ist sicherheitsrelevant oder führt zu Mietminderung. Termin innerhalb der nächsten 48 Stunden vereinbaren."
    : "";
  const urgentEn = tone === "urgent"
    ? "URGENT. The defect is safety-relevant or may lead to rent reduction. Schedule within 48 hours."
    : "";

  const prompt = lang === "de"
    ? `Du bist die Sachbearbeiterin Anna Berger bei Huber & Partner Immobilienverwaltung GmbH.
Du schreibst eine geschäftliche E-Mail an: ${req.to}
E-Mail-Adresse: ${req.to_email}
Betreff: ${req.subject}

Was passiert ist: ${req.incident_summary}
Weitere Details: ${req.entity_context}
${urgentDe}

Regeln:
- Nur den E-Mail-Body schreiben, KEINE Header (kein "Von:", kein "An:", kein "Betreff:").
- Beginne mit der korrekten Anrede: "Sehr geehrte Frau [Name]," oder "Sehr geehrter Herr [Name],". Wenn der Empfänger eine Firma ist: "Sehr geehrte Damen und Herren,".
- Beschreibe kurz das Problem und was die Verwaltung unternimmt.
- Nenne einen konkreten nächsten Schritt mit Zeitrahmen (z.B. "Wir werden bis Freitag einen Termin vereinbaren").
- Ende mit: "Mit freundlichen Grüßen\\n\\nAnna Berger\\nHuber & Partner Immobilienverwaltung GmbH\\nFriedrichstraße 112, 10117 Berlin\\nTel: +49 30 12345-0"
- Maximal 6 Sätze im Hauptteil. Kein Fülltext, keine Phrasen wie "wir nehmen Ihr Anliegen sehr ernst".
- Schreibe wie eine echte Hausverwalterin: sachlich, direkt, verbindlich.`
    : `You are property manager Anna Berger at Huber & Partner Immobilienverwaltung GmbH.
Write a business email to: ${req.to}
Email: ${req.to_email}
Subject: ${req.subject}

What happened: ${req.incident_summary}
Details: ${req.entity_context}
${urgentEn}

Rules:
- Body only — NO headers (no "From:", "To:", "Subject:").
- Start with proper salutation: "Dear Mr./Ms. [Name]," or "Dear Sir or Madam," for companies.
- Briefly describe the issue and what the management is doing about it.
- Name one concrete next step with a timeframe (e.g. "We will schedule an appointment by Friday").
- End with: "Kind regards,\\n\\nAnna Berger\\nHuber & Partner Immobilienverwaltung GmbH\\nFriedrichstraße 112, 10117 Berlin\\nTel: +49 30 12345-0"
- Maximum 6 sentences in the body. No filler, no "we take your concern very seriously".
- Write like a real property manager: factual, direct, reliable.`;

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
