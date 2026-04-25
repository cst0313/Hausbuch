// path: src/app/api/query/route.ts
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { render } from "@/lib/renderer";
import type { Detail } from "@/lib/types";
import { Ablation, ragBaselineAnswer, longContextBaselineAnswer } from "@/lib/ablations";
import { compose, type Persona } from "@/lib/compose";
import { longContextClaude, ragChunkClaude } from "@/lib/claude-baselines";
import { listSources } from "@/lib/db";
import { compose as geminiCompose, GeminiError } from "@/lib/llm/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Provider = "gemini" | "anthropic" | "auto";

export async function POST(req: NextRequest) {
  db();
  const body = await req.json();
  const entity = body?.entity;
  const question = body?.question;
  if (!entity || !question) {
    return NextResponse.json({ error: "entity and question are required" }, { status: 400 });
  }
  const detail = (body.detail ?? 3) as Detail;
  const at_valid = body.at_valid ?? body.at ?? undefined;
  const at_known = body.at_known ?? body.at ?? undefined;
  const ablate: Ablation = (body.ablate ?? "none") as Ablation;
  const persona: Persona = (body.persona ?? "plain") as Persona;
  const baseline = (body.baseline ?? null) as "rag" | "longctx" | null;
  const provider: Provider = (body.provider ?? "auto") as Provider;

  const t0 = performance.now();

  if (baseline === "rag" || ablate === "all") {
    // Try Claude if key is set → real RAG (keyword-retrieve + generate)
    const viaClaude = await ragChunkClaude(question);
    if (viaClaude) {
      return NextResponse.json({
        answer: viaClaude.answer,
        citations: [],
        tokens_in: viaClaude.tokens_in,
        tokens_out: viaClaude.tokens_out,
        cache_hit: viaClaude.cache_hit,
        latency_ms: viaClaude.latency_ms,
        model: viaClaude.model,
        baseline,
        ablate,
        persona,
      });
    }
    // Fallback: simulated keyword top-k retrieval, no LLM
    const r = ragBaselineAnswer(question);
    return NextResponse.json({
      answer: r.answer,
      citations: [],
      tokens_in: r.tokens_in, // only retrieved chunks, NOT full corpus
      tokens_out: Math.ceil(r.answer.length / 4),
      tokens_corpus_equiv: r.tokens_corpus_equiv,
      cache_hit: false,
      latency_ms: Math.round(performance.now() - t0),
      model: "rag-baseline-simulated",
      baseline,
      ablate,
      persona,
    });
  }

  if (baseline === "longctx") {
    // Try Claude first → real long-context (full corpus → Claude → answer)
    const viaClaude = await longContextClaude(question);
    if (viaClaude) {
      return NextResponse.json({
        answer: viaClaude.answer,
        citations: [],
        tokens_in: viaClaude.tokens_in,
        tokens_out: viaClaude.tokens_out,
        cache_hit: viaClaude.cache_hit,
        latency_ms: viaClaude.latency_ms,
        model: viaClaude.model,
        baseline,
        ablate,
        persona,
      });
    }
    // Fallback: simulated long-context with known failure modes
    const r = longContextBaselineAnswer(question);
    return NextResponse.json({
      answer: r.answer,
      citations: [],
      tokens_in: r.tokens_in,
      tokens_out: Math.ceil(r.answer.length / 4),
      cache_hit: false,
      latency_ms: Math.round(performance.now() - t0),
      model: "long-context-simulated",
      baseline,
      ablate,
      persona,
    });
  }

  const contextMd = render(entity, { detail, at_valid, at_known });
  const tokensIn = estimateTokens(contextMd) + estimateTokens(question) + 200;

  // Provider routing.
  //   - provider=gemini   → Gemini, fall back to compose() on error.
  //   - provider=anthropic→ Anthropic, fall back to compose() on error.
  //   - provider=auto     → Gemini first if its key is set (Anthropic balance is 0
  //                          on this deploy), else Anthropic, else compose().
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const resolved: Provider =
    provider === "auto"
      ? hasGemini
        ? "gemini"
        : hasAnthropic
          ? "anthropic"
          : "auto"
      : provider;

  if (resolved === "gemini" && hasGemini) {
    try {
      const systemText = personaSystem(persona);
      const out = await geminiCompose({
        prompt: question,
        context: `${systemText}\n\n---\n\n${contextMd}`,
      });
      return NextResponse.json({
        answer: out.text,
        citations: extractCitations(out.text),
        context_md: contextMd,
        tokens_in: out.tokens_in || tokensIn,
        tokens_out: out.tokens_out,
        tokens_longctx_equiv: estimateLongContextTokens(),
        cache_hit: false,
        latency_ms: out.latency_ms,
        model: out.model,
        provider: "gemini",
        ablate,
        persona,
      });
    } catch (err) {
      const reason =
        err instanceof GeminiError ? err.kind : err instanceof Error ? err.name : "unknown";
      console.error("[lumen] gemini query failed:", reason);
      // If Anthropic is available, try it next.
      if (hasAnthropic) {
        return await anthropicAttempt({
          question,
          contextMd,
          tokensIn,
          ablate,
          persona,
          entity,
          at_valid,
          at_known,
          t0,
        });
      }
      return composeFallback({
        entity,
        question,
        persona,
        at_valid,
        at_known,
        ablate,
        contextMd,
        tokensIn,
        t0,
        error: `gemini-${reason}`,
      });
    }
  }

  if (resolved === "anthropic" && hasAnthropic) {
    return await anthropicAttempt({
      question,
      contextMd,
      tokensIn,
      ablate,
      persona,
      entity,
      at_valid,
      at_known,
      t0,
    });
  }

  // No provider available — local compose.
  return composeFallback({
    entity,
    question,
    persona,
    at_valid,
    at_known,
    ablate,
    contextMd,
    tokensIn,
    t0,
  });
}

type AttemptArgs = {
  question: string;
  contextMd: string;
  tokensIn: number;
  ablate: Ablation;
  persona: Persona;
  entity: string;
  at_valid?: string;
  at_known?: string;
  t0: number;
};

async function anthropicAttempt(args: AttemptArgs): Promise<NextResponse> {
  try {
    const client = new Anthropic();
    const systemText = personaSystem(args.persona);
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: [
        { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
        { type: "text", text: args.contextMd, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: args.question }],
    });
    const latency_ms = Math.round(performance.now() - args.t0);
    const answer = msg.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    const usage = msg.usage as unknown as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
    };
    return NextResponse.json({
      answer,
      citations: extractCitations(answer),
      context_md: args.contextMd,
      tokens_in: usage?.input_tokens ?? args.tokensIn,
      tokens_out: usage?.output_tokens ?? 0,
      tokens_longctx_equiv: estimateLongContextTokens(),
      cache_hit: (usage?.cache_read_input_tokens ?? 0) > 0,
      cache_read: usage?.cache_read_input_tokens ?? 0,
      latency_ms,
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      ablate: args.ablate,
      persona: args.persona,
    });
  } catch (err) {
    console.error("[lumen] anthropic query failed:", err);
    return composeFallback({
      entity: args.entity,
      question: args.question,
      persona: args.persona,
      at_valid: args.at_valid,
      at_known: args.at_known,
      ablate: args.ablate,
      contextMd: args.contextMd,
      tokensIn: args.tokensIn,
      t0: args.t0,
      error: "claude-unreachable",
    });
  }
}

type FallbackArgs = {
  entity: string;
  question: string;
  persona: Persona;
  at_valid?: string;
  at_known?: string;
  ablate: Ablation;
  contextMd: string;
  tokensIn: number;
  t0: number;
  error?: string;
};

function composeFallback(args: FallbackArgs): NextResponse {
  const composed = compose(
    args.entity,
    args.question,
    args.persona,
    { at_valid: args.at_valid, at_known: args.at_known },
    args.ablate,
  );
  return NextResponse.json({
    answer: composed.answer,
    citations: composed.citations,
    context_md: args.contextMd,
    tokens_in: args.tokensIn,
    tokens_out: estimateTokens(composed.answer),
    tokens_longctx_equiv: estimateLongContextTokens(),
    cache_hit: false,
    latency_ms: Math.round(performance.now() - args.t0),
    model: args.ablate === "none" ? "compose-fallback" : `compose-ablate-${args.ablate}`,
    provider: "fallback",
    ...(args.error ? { error: args.error } : {}),
    ablate: args.ablate,
    persona: args.persona,
  });
}

/**
 * How many tokens would a naive long-context call cost for this same question?
 * Sum the tokenized length of every source excerpt currently in the DB + a
 * small overhead for system prompt + question + response budget.
 */
function estimateLongContextTokens(): number {
  const overhead = 220;
  const sources = listSources();
  const corpusChars = sources.reduce((n, s) => n + s.raw_excerpt.length, 0);
  return Math.ceil(corpusChars / 4) + overhead;
}

function personaSystem(persona: Persona): string {
  const base =
    "You read a bitemporal Context.md and answer grounded questions about a single entity. " +
    "Always cite the source file after each non-trivial claim in the form `(source.pdf)` or `(source.pdf p.3)`. " +
    "Never invent facts not present in the document. If a predicate is contested, surface both values, " +
    "explain the posterior in plain language, and recommend which to treat as operative.";
  if (persona === "drafter") {
    return (
      base +
      "\n\nReply as an English-speaking property-management professional drafting a short formal email. " +
      "Use a 'Dear Mr./Ms. <surname>,' salutation, 2–4 sentences of body, and sign off as " +
      "'Kind regards, Müller Immobilien GmbH'. Tone: warm, precise, statute-aware. Respond in English."
    );
  }
  if (persona === "chatbot") {
    return (
      base +
      "\n\nReply as a helpful AI leasing assistant in English. 2–4 sentences. Conversational, " +
      "confident, never hand-wave. When uncertainty exists, make the tradeoff concrete."
    );
  }
  return base + " Answer concisely, one or two sentences.";
}

function extractCitations(answer: string): string[] {
  const matches = Array.from(answer.matchAll(/\^\[([^\]]+)\]|\(([^)]+\.(pdf|eml|md|txt))[^)]*\)/g));
  return matches.map((m) => m[1] ?? m[2]).filter(Boolean) as string[];
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}
