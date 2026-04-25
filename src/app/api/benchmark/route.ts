// path: src/app/api/benchmark/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, listSources, closeDb } from "@/lib/db";
import { DEMO_SCENARIOS, ENTITY } from "@/lib/seed";
import { ingest } from "@/lib/ingest";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BenchmarkQuestion = {
  category: "basic" | "temporal" | "conflict";
  question: string;
  golden_snippet?: string;
  golden_regex_src?: string;
  at_valid?: string;
};

const QUESTIONS: BenchmarkQuestion[] = [
  { category: "basic", question: "Who is the current tenant of Apt 3?", golden_snippet: "Anna Schmidt" },
  { category: "basic", question: "How many units are in the building?", golden_snippet: "6" },
  { category: "basic", question: "Who is the owner?", golden_snippet: "Müller" },
  { category: "temporal", question: "What was the rent in February 2024?", golden_snippet: "1400", at_valid: "2024-02-15T00:00:00Z" },
  { category: "temporal", question: "What was the rent before March 2024?", golden_snippet: "1400", at_valid: "2024-02-15T00:00:00Z" },
  { category: "temporal", question: "When does the current lease expire?", golden_snippet: "2027-02-28" },
  { category: "temporal", question: "When was the last inspection?", golden_snippet: "2026-02-14" },
  { category: "temporal", question: "What is the rent for June 2026?", golden_snippet: "1650" },
  { category: "conflict", question: "What is the next rent and is it contested?", golden_snippet: "contested" },
  { category: "conflict", question: "Who says the rent should be €1,800?", golden_snippet: "landlord" },
  { category: "conflict", question: "Which source caps the rent at €1,650?", golden_snippet: "legal-memo" },
  { category: "conflict", question: "What is the posterior on the rent dispute?", golden_snippet: "posterior" },
  { category: "basic", question: "Are there any open tickets?", golden_snippet: "1" },
  { category: "basic", question: "What's the current rent?", golden_snippet: "1500" },
  { category: "temporal", question: "When did Anna's tenancy begin?", golden_snippet: "2024-03-01" },
];

type Ablation = "none" | "bitemporality" | "conflict" | "attribution" | "all";

const ABLATIONS: Array<{ id: Ablation; label: string }> = [
  { id: "none", label: "Hausbuch (full)" },
  { id: "bitemporality", label: "– bitemporality" },
  { id: "conflict", label: "– Dawid-Skene" },
  { id: "attribution", label: "– citations" },
  { id: "all", label: "RAG baseline" },
];

/**
 * Runs the 15-question benchmark against each ablation config and returns a
 * real measured matrix. Resets the DB and re-ingests the full scenario each
 * run so the corpus is identical across ablations.
 *
 * This is what /research uses. The numbers that come back are measured,
 * not hardcoded.
 */
export async function GET(_req: NextRequest) {
  await resetDb();
  db();
  // Ingest the full scenario once — the DB contents are the same for every ablation
  for (const s of DEMO_SCENARIOS) {
    await ingest({
      entity: ENTITY,
      source: {
        kind: s.kind,
        title: s.title,
        raw_excerpt: s.raw_excerpt,
        source_prior: s.source_prior,
      },
    });
  }
  void listSources(); // sanity

  const rows: Array<{
    ablation: Ablation;
    label: string;
    correct: number;
    total: number;
    accuracy: number;
    by_category: Record<string, { correct: number; total: number }>;
    tokens_total: number;
    latency_total: number;
    sample_answers: Array<{ q: string; a: string; ok: boolean; cat: string }>;
  }> = [];

  for (const { id, label } of ABLATIONS) {
    let correct = 0;
    let tokens_total = 0;
    let latency_total = 0;
    const by_category: Record<string, { correct: number; total: number }> = {};
    const sample_answers: Array<{ q: string; a: string; ok: boolean; cat: string }> = [];

    for (const q of QUESTIONS) {
      const t0 = performance.now();
      // Hit our own query route in-process — avoid loopback HTTP, just invoke the handler.
      const res = await runSingleQuery(q.question, id, q.at_valid);
      const latency = Math.round(performance.now() - t0);

      const normalize = (s: string) => s.toLowerCase().replace(/(\d),(\d)/g, "$1$2");
      const ok = q.golden_regex_src
        ? new RegExp(q.golden_regex_src, "i").test(res.answer)
        : q.golden_snippet
          ? normalize(res.answer).includes(normalize(q.golden_snippet))
          : false;

      by_category[q.category] ??= { correct: 0, total: 0 };
      by_category[q.category].total += 1;
      if (ok) {
        correct += 1;
        by_category[q.category].correct += 1;
      }
      tokens_total += res.tokens_in;
      latency_total += latency;
      sample_answers.push({ q: q.question, a: res.answer, ok, cat: q.category });
    }

    rows.push({
      ablation: id,
      label,
      correct,
      total: QUESTIONS.length,
      accuracy: correct / QUESTIONS.length,
      by_category,
      tokens_total,
      latency_total,
      sample_answers,
    });
  }

  return NextResponse.json({
    rows,
    questions: QUESTIONS.map((q) => ({ category: q.category, question: q.question })),
    ablations: ABLATIONS,
    timestamp: new Date().toISOString(),
  });
}

async function resetDb() {
  closeDb();
  const DB_PATH = path.resolve(process.cwd(), "data", "hausbuch.db");
  for (const p of [DB_PATH, DB_PATH + "-wal", DB_PATH + "-shm"]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // ignore
    }
  }
  db();
}

/**
 * Call the query pipeline in-process (no HTTP) so the benchmark is fast and
 * doesn't depend on server loopback.
 */
async function runSingleQuery(
  question: string,
  ablate: Ablation,
  at_valid: string | undefined,
) {
  const payload = { entity: ENTITY, question, ablate, at_valid, detail: 3 };
  const mod = await import("../query/route");
  const req = new Request("http://internal/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const res = await mod.POST(req as unknown as NextRequest);
  return (await res.json()) as { answer: string; tokens_in: number; latency_ms: number };
}
