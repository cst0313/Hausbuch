// path: src/lib/claude-baselines.ts
import Anthropic from "@anthropic-ai/sdk";
import { listSources } from "./db";

/**
 * Real Claude-backed baselines for the benchmark, used when
 * ANTHROPIC_API_KEY is set. These produce honest, measurable outputs — not
 * simulations. The /api/query route falls back to the heuristic simulator in
 * src/lib/ablations.ts when no key is available.
 */

type Result = {
  answer: string;
  tokens_in: number;
  tokens_out: number;
  cache_hit: boolean;
  cache_read: number;
  latency_ms: number;
  model: string;
};

export async function longContextClaude(question: string): Promise<Result | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const sources = listSources();
  // Full corpus: every source title + excerpt, separated with doc markers.
  const corpus = sources
    .map((s) => `## Document: ${s.title}\nType: ${s.kind}\nIngested: ${s.ingested_at}\n\n${s.raw_excerpt}`)
    .join("\n\n---\n\n");

  const system =
    "You answer questions about a rental property using ONLY the documents below. " +
    "Be concise — 1–3 sentences. Cite the source document in parentheses when you state " +
    "a fact. If multiple documents disagree, say so and state both values. Do not invent " +
    "anything not in the documents.";

  return await call(system, corpus, question, "long-context-claude");
}

export async function ragChunkClaude(question: string): Promise<Result | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const sources = listSources();
  // Top-k keyword retrieval: score each source by keyword overlap with the question.
  const qTokens = new Set(
    question
      .toLowerCase()
      .replace(/[^a-z0-9äöüß€\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 3),
  );
  const scored = sources.map((s) => {
    const tokens = s.raw_excerpt.toLowerCase().split(/\s+/);
    let score = 0;
    for (const t of tokens) if (qTokens.has(t)) score += 1;
    return { source: s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const topK = scored.slice(0, 3).filter((x) => x.score > 0);

  if (topK.length === 0) {
    return {
      answer: "No relevant chunks retrieved.",
      tokens_in: Math.ceil(question.length / 4) + 100,
      tokens_out: 7,
      cache_hit: false,
      cache_read: 0,
      latency_ms: 0,
      model: "rag-retrieve-claude (no hits)",
    };
  }

  const chunks = topK
    .map((x) => `## Retrieved chunk: ${x.source.title}\n\n${x.source.raw_excerpt}`)
    .join("\n\n---\n\n");

  const system =
    "You answer questions using ONLY the retrieved chunks below. " +
    "Be concise. Cite the chunk you used. If the chunks don't contain the answer, say so.";

  return await call(system, chunks, question, "rag-retrieve-claude");
}

async function call(
  system: string,
  corpus: string,
  question: string,
  modelLabel: string,
): Promise<Result | null> {
  try {
    const client = new Anthropic();
    const t0 = performance.now();
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
        { type: "text", text: corpus, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: question }],
    });
    const latency_ms = Math.round(performance.now() - t0);
    const answer = msg.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    const usage = msg.usage as unknown as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
    return {
      answer,
      tokens_in: usage?.input_tokens ?? 0,
      tokens_out: usage?.output_tokens ?? 0,
      cache_hit: (usage?.cache_read_input_tokens ?? 0) > 0,
      cache_read: usage?.cache_read_input_tokens ?? 0,
      latency_ms,
      model: modelLabel,
    };
  } catch (err) {
    console.error(`[claude-baseline:${modelLabel}] call failed:`, err);
    return null;
  }
}
