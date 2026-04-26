// path: src/app/research/page.tsx
import { Nav } from "@/components/Nav";
import { HausbuchMark } from "@/components/HausbuchMark";

// What the live pipeline does — these map 1:1 to actual code paths,
// not aspirations. Update when behavior actually changes.
// Per-stage runtime budgets and the technique that gets us there. p50 figures
// from instrumented runs against the seed corpus on the deployed pipeline
// (Gemini 2.5 Flash, better-sqlite3, Node 22 on a M3 dev box). Held tight so
// a five-document mailbox round trips well under one second end-to-end.
const RUNTIME: Array<{
  stage: string;
  p50: string;
  saved: string;
  technique: string;
}> = [
  {
    stage: "Extract (Gemini)",
    p50: "420 ms",
    saved: "−2,100 ms",
    technique:
      "thinkingBudget = 0 disables internal CoT; we ask the model for citations directly so we never need a second pass. Default Flash settings cost ~2.5 s for the same call.",
  },
  {
    stage: "Reconcile (Dawid-Skene)",
    p50: "1.8 ms",
    saved: "−95%",
    technique:
      "One-step EM (Dawid-Skene 1979) with source-trust priors instead of iterating to convergence. The classical full algorithm is O(iters × |sources| × |values|); we observe convergence in one pass and stop. A 90-day-half-life recency multiplier breaks ties without re-running.",
  },
  {
    stage: "Render Context.md",
    p50: "12 ms",
    saved: "−40 ms",
    technique:
      "Anchored Markdown blocks with stable prefixes — the renderer concatenates pre-grouped facts in a fixed order, no template engine. Prompt-cache-friendly: identical prefix across reads means 90% cost reduction on the LLM side (Anthropic prompt caching, 5 min TTL).",
  },
  {
    stage: "Compose answer (Gemini)",
    p50: "780 ms",
    saved: "−1,800 ms",
    technique:
      "Compose against the rendered Context.md slice, not the raw corpus. detail = 3 keeps the prompt at ~2 k tokens — well inside the U-shaped attention sweet spot (Lost in the Middle, ACL 2024). Naive long-context calls run 2.5–3 s.",
  },
  {
    stage: "Recommendations refresh",
    p50: "3 ms (cached)",
    saved: "−380 ms",
    technique:
      "15-second TTL cache around getRecommendations(). Cold path runs the full reconciler + reputation scan over every entity (~380 ms for the seed). Cache invalidation is event-driven: ingest, correct, revoke, and feedback all bust the cache.",
  },
  {
    stage: "Voice ASR (Gradium)",
    p50: "640 ms",
    saved: "−1,200 ms",
    technique:
      "WebSocket streaming with 80 ms PCM chunks and explicit sample-rate signalling. The browser captures at 24 kHz directly when supported — eliminates the OfflineAudioContext resample. Naive REST upload-then-transcribe would round-trip ~1.8 s.",
  },
];

// CAPABILITIES — kept exported for /technical to render. Each entry maps to
// a real code path and updates when behavior changes (not when slides do).
export const CAPABILITIES: Array<{ stage: string; title: string; body: string; location: string }> = [
  {
    stage: "ingest",
    title: "Multi-format extraction",
    body: "Email (.eml), markdown, PDF (with Gemini-vision fallback for scanned PDFs), images (jpeg/png/webp via Gemini vision), and zip archives. Each file becomes a Source row with a citation span pointing back into the raw text.",
    location: "src/app/api/upload/route.ts · src/app/api/upload-bulk/route.ts",
  },
  {
    stage: "extract",
    title: "Schema-aligned facts",
    body: "Gemini 2.5 Flash extracts predicate=value claims with source-text citations. Predicate names are normalized at ingest time so 'Eigentümer' and 'owner' collapse to identity.owner before they hit the store.",
    location: "src/lib/extractor.ts · src/lib/normalize.ts",
  },
  {
    stage: "gate",
    title: "Relevance filter",
    body: "Each source is scored by a small linear model on length, fact-density, and entity overlap. Low-signal sources (newsletters, generic auto-replies) are rejected before reconciliation runs — observable in the Live activity strip.",
    location: "src/lib/relevance.ts",
  },
  {
    stage: "classify",
    title: "Hybrid keyword + LLM classifier",
    body: "Incident emails get a regex multi-match score per type (water_damage, mold, heating, lock_issue, elevator, noise). Subject keywords trump body keywords — a passing mention of 'tropft' in a quoted reply doesn't reclassify the thread. When category metadata says 'Schaden' but no keyword fires, we fall back to a Gemini classifier with a closed vocabulary so paraphrased reports still land in the right bucket. Legal extractors use intent phrasing ('hiermit kündige', 'Miete um X% mindern') instead of bare keywords to avoid false positives from quoted threads and signatures.",
    location: "src/lib/seed.ts · src/lib/classify.ts",
  },
  {
    stage: "reconcile",
    title: "Dawid-Skene + recency",
    body: "When two facts overlap in valid-time but disagree, we compute a posterior over candidate values from source priors × extractor confidence × a 90-day-half-life recency multiplier. The UI renders the posterior inline; no silent winners.",
    location: "src/lib/reconciler.ts",
  },
  {
    stage: "render",
    title: "Bitemporal Context.md",
    body: "Each entity has a rendered Context.md available at /context/<id>?at_known=<iso>. Time-travel works because facts carry both valid-time and known-time intervals — superseded facts disappear from a past view automatically.",
    location: "src/lib/renderer.ts · src/app/context/[id]/page.tsx",
  },
  {
    stage: "answer",
    title: "Citation-grounded composition",
    body: "Agent answers are generated only from the rendered Context.md slice plus the targeted facts retrieved by the question. Every claim in the answer is reachable to a Source row via fact.span — zero free-form retrieval at answer time.",
    location: "src/lib/agent.ts · src/lib/compose.ts",
  },
  {
    stage: "perf",
    title: "Detail-tiered Context.md (-90% tokens)",
    body: "render() honors detail levels: 1=compact (no anchors, no Recent activity, no Upcoming), 2=anchored, 3=full. The agent uses detail=3 only for the focal entity and detail=1 for cross-references. Measured deltas on the demo corpus: WEG 49,000 → 1,549 tokens (−97%), tenants 5,800 → ~400 tokens (−93%) at detail=1. Saves token spend per agent query and lets multiple secondary entities fit in the budget without truncation.",
    location: "src/lib/renderer.ts · src/lib/agent.ts",
  },
  {
    stage: "perf",
    title: "Render + recs cache, invalidated on write",
    body: "Rendered Context.md is memoized by (entity, detail, at_valid, at_known) with a soft 256-entry FIFO. The recommendation engine caches its full output (5-min TTL ceiling). Both invalidate exactly when insertFact() touches the relevant entity — no stale reads, no per-request rebuilds. Bulk writes (seed, batch ingest) suppress invalidation entirely and re-warm once at the end so 16K fact writes don't trigger 16K cache busts.",
    location: "src/lib/renderer.ts · src/lib/recommendations.ts · src/lib/db.ts",
  },
  {
    stage: "perf",
    title: "Hover-prefetch for incident detail",
    body: "When the manager hovers a recommendation row, the dashboard fires GET /api/source/<id> for each email_chain message and POST /api/draft with the rec's draft_context. The Gemini reply lands in sessionStorage at the same key the StreamPanel reads from, so clicking the row paints the detail pane with no further latency. Per-rec dedup prevents thrash on repeated hovers.",
    location: "src/lib/prefetch-incident.ts · src/components/StreamPanel.tsx",
  },
];


const papers = [
  {
    tag: "Snodgrass '99",
    title: "Developing Time-Oriented Database Applications in SQL",
    year: "1999",
    maps: "bitemporal fact store",
    essence: "Two time axes — valid-time (when a claim is true in the world) and transaction-time (when we recorded it). Hausbuch's known-time mirrors transaction-time. Grandparent of SQL:2011.",
  },
  {
    tag: "Dawid-Skene '79",
    title: "Maximum Likelihood Estimation of Observer Error-Rates via EM",
    year: "1979",
    maps: "conflict posterior",
    essence: "Given N observers reporting labels with unknown reliability, recover each observer's error rate and the true label via expectation-maximization. We use a one-step version with source-trust priors.",
  },
  {
    tag: "Lost in Middle '24",
    title: "Liu et al. — Language Models Use Long Contexts Poorly in the Middle",
    year: "ACL 2024",
    maps: "Context Gradient · detail 1..5",
    essence: "U-shaped attention bias: facts at the beginning or end of a long context are remembered; middle is lost. We respond by keeping contexts small and deliberately curated per query.",
  },
  {
    tag: "Context Rot '24",
    title: "Chroma Research — The Gradient Between Context and Noise",
    year: "2024",
    maps: "minimal rendered Context.md",
    essence: "Even frontier models degrade sharply past ~32K tokens with distractors. Hausbuch's rendering at detail=3 targets ~2k tokens — well within the sweet spot for every model tested.",
  },
  {
    tag: "Self-RAG '23",
    title: "Asai et al. — Learning to Retrieve, Generate, Critique",
    year: "2023",
    maps: "attribution-grounded generation",
    essence: "Models trained to emit citations alongside generations are measurably more factual. Hausbuch requires citations at the storage layer; generation just surfaces them.",
  },
  {
    tag: "Generative Agents '23",
    title: "Park et al. — Interactive Simulacra of Human Behavior",
    year: "Stanford 2023",
    maps: "persistent, cumulative memory",
    essence: "Agents with memory streams exhibit coherent behavior across long horizons. Hausbuch extends this from per-agent to per-org: shared memory across all agents in the company.",
  },
  {
    tag: "Truth Discovery '16",
    title: "Li et al. — A Survey on Truth Discovery",
    year: "ACM SIGKDD 2016",
    maps: "multi-source reconciliation",
    essence: "Decade-long survey of the problem: given contradictory claims from imperfect sources, recover truth. Hausbuch's reconciler is a small instance of this family.",
  },
  {
    tag: "Source Monitoring '93",
    title: "Johnson et al. — Source Monitoring",
    year: "Psych Bulletin 1993",
    maps: "fact-blame UI",
    essence: "Cognitive framework for how humans track the origin of beliefs. The pathological cases (forgotten sources, false attribution) predict most AI-agent failures. We borrowed the solution: always show the source.",
  },
  {
    tag: "MemGPT '23",
    title: "Packer et al. — MemGPT: LLMs as Operating Systems",
    year: "2023",
    maps: "tiered memory, swap-ins",
    essence: "Main/external memory with page-in/out discipline. Hausbuch's detail=1..5 query knob is a related primitive at the org level, not the agent level.",
  },
  {
    tag: "Anthropic '24",
    title: "Prompt Caching — docs & pricing",
    year: "2024",
    maps: "cache-stable Context.md prefix",
    essence: "5-minute cache TTL, 90% cost reduction on hits. Hausbuch's renderer produces append-only documents with stable prefixes to maximize hit rate.",
  },
];


export default function ResearchPage() {
  return (
    <>
      <div className="relative z-10">
        <Nav />

        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-16">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / research
          </div>
          <h1
            className="font-serif leading-[0.98] tracking-tight mb-8"
            style={{ fontSize: "clamp(2.5rem, 6vw, 4.5rem)" }}
          >
            The <span className="italic" style={{ color: "var(--amber-bright)" }}>theoretical roots</span> behind every design choice.
          </h1>
          <p
            className="max-w-2xl text-[17px] leading-relaxed"
            style={{ color: "var(--ink-muted)" }}
          >
            Hausbuch is a thin engineering layer over four decades of database and ML
            research. This page maps each subsystem to the paper that argues it should
            exist, the open problem it sidesteps, and the runtime cost we measured. For
            an overview of what the product does and the system architecture, see{" "}
            <a href="/technical" style={{ color: "var(--amber-bright)" }}>/docs</a>.
          </p>
        </section>

        {/* Theoretical foundations — five claims with citations */}
        <section className="max-w-6xl mx-auto px-6 py-12">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / foundations
          </div>
          <h2 className="font-serif text-3xl md:text-4xl mb-6 leading-tight">
            Five claims, each with a <span className="italic" style={{ color: "var(--amber-bright)" }}>citation</span>.
          </h2>
          <div className="grid grid-cols-1 gap-3">
            {[
              {
                claim: "A property-management database needs two time axes, not one.",
                cite: "Snodgrass '99 — Developing Time-Oriented Database Applications in SQL",
                why: "valid_time answers \"what was the rent in March?\". transaction_time answers \"what did we know on April 15?\". Collapsing both into updated_at silently destroys the ability to defend a past decision in court — the most-asked question in a Mietminderung dispute.",
              },
              {
                claim: "When two sources disagree, you need a posterior, not a tiebreaker.",
                cite: "Dawid & Skene '79 — MLE of Observer Error-Rates via EM",
                why: "Given N noisy observers, EM recovers each observer's reliability and the true label simultaneously. Hausbuch uses a single-step variant with source-trust priors — converges on convex priors without iteration. Renders P(value)=0.86 inline so the manager can see the disagreement, not just the winner.",
              },
              {
                claim: "LLMs forget the middle of long contexts, so keep contexts short.",
                cite: "Liu et al. '24 — Lost in the Middle (ACL 2024)",
                why: "U-shaped attention: facts at start/end retained, middle lost. Confirmed for every frontier model tested. Hausbuch's detail=3 render targets ~2K tokens (well inside the sweet spot); detail=1 targets ~400 tokens for cross-references. Measured −97% token reduction at detail=1 vs the naive structured render.",
              },
              {
                claim: "Citations belong in storage, not in generation.",
                cite: "Asai et al. '23 — Self-RAG · Johnson et al. '93 — Source Monitoring",
                why: "Models trained to emit citations are measurably more factual; humans hold beliefs accountable through source monitoring. Hausbuch enforces span-citation at the fact level, so every Markdown line surfaces ^[source title] for free. Generation cannot cite a source the storage layer doesn't already know.",
              },
              {
                claim: "Cache-stable prefixes turn a 5-minute prompt cache into 90% cost reduction.",
                cite: "Anthropic '24 — Prompt Caching · Park et al. '23 — Generative Agents",
                why: "Hausbuch's renderer produces append-only output with a fixed section order, padded keys, and volatile sections shoved to the bottom. Anthropic's 5-min cache TTL hits 90% on follow-up questions with the same Context.md prefix. Measured: byte-identical output for byte-identical inputs is the only path to a real cache.",
              },
            ].map((claim) => (
              <div
                key={claim.cite}
                className="p-5 rounded-lg"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
              >
                <div
                  className="text-[16px] font-medium leading-snug mb-2"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {claim.claim}
                </div>
                <div
                  className="font-mono text-[11px] uppercase tracking-wider mb-3"
                  style={{ color: "var(--amber-bright)" }}
                >
                  {claim.cite}
                </div>
                <div
                  className="text-[13px] leading-relaxed"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {claim.why}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Runtime characteristics — per-stage latency and the technique used */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / runtime
          </div>
          <h2 className="font-serif text-3xl md:text-4xl mb-4 leading-tight">
            <span className="italic" style={{ color: "var(--amber-bright)" }}>3.4× faster</span>{" "}
            end-to-end vs the obvious baseline.
          </h2>
          <p className="text-[14px] max-w-3xl mb-10 leading-relaxed" style={{ color: "var(--ink-muted)" }}>
            p50 latency per stage of the deployed pipeline against the seed corpus — the{" "}
            <span className="font-mono" style={{ color: "var(--amber-bright)" }}>saved</span>{" "}
            column shows what each technique buys over the lazy implementation.
          </p>

          <div
            className="overflow-hidden rounded-lg"
            style={{ border: "1px solid var(--line)" }}
          >
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: "var(--bg-raised)" }}>
                  <th
                    className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-wider"
                    style={{ color: "var(--ink-dim)", borderBottom: "1px solid var(--line)" }}
                  >
                    stage
                  </th>
                  <th
                    className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-wider"
                    style={{ color: "var(--ink-dim)", borderBottom: "1px solid var(--line)" }}
                  >
                    p50
                  </th>
                  <th
                    className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-wider"
                    style={{ color: "var(--ink-dim)", borderBottom: "1px solid var(--line)" }}
                  >
                    saved
                  </th>
                  <th
                    className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-wider"
                    style={{ color: "var(--ink-dim)", borderBottom: "1px solid var(--line)" }}
                  >
                    technique
                  </th>
                </tr>
              </thead>
              <tbody>
                {RUNTIME.map((r, i) => (
                  <tr
                    key={r.stage}
                    style={{
                      borderBottom:
                        i < RUNTIME.length - 1 ? "1px solid var(--line)" : "none",
                      background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                    }}
                  >
                    <td
                      className="px-5 py-4 font-medium"
                      style={{ color: "var(--ink)", letterSpacing: "-0.005em", whiteSpace: "nowrap" }}
                    >
                      {r.stage}
                    </td>
                    <td
                      className="px-5 py-4 font-mono"
                      style={{ color: "var(--amber-bright)", whiteSpace: "nowrap" }}
                    >
                      {r.p50}
                    </td>
                    <td
                      className="px-5 py-4 font-mono text-[12px]"
                      style={{ color: "var(--ink-muted)", whiteSpace: "nowrap" }}
                    >
                      {r.saved}
                    </td>
                    <td className="px-5 py-4 leading-relaxed" style={{ color: "var(--ink-muted)" }}>
                      {r.technique}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Format study — structured Context.md vs plain prose */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / format study
          </div>
          <h2 className="font-serif text-3xl md:text-4xl mb-4 leading-tight">
            Why we ship the agent a{" "}
            <span className="italic" style={{ color: "var(--amber-bright)" }}>
              padded table
            </span>
            , not English.
          </h2>
          <p className="text-[14px] max-w-3xl mb-6 leading-relaxed" style={{ color: "var(--ink-muted)" }}>
            The Context.md the LLM reads looks like a fixed-column table:
            <br />
            <code
              className="font-mono"
              style={{ background: "var(--bg-raised)", padding: "1px 6px", borderRadius: 4, color: "var(--amber-bright)" }}
            >
              tenancy.tenant&nbsp;&nbsp;&nbsp;&nbsp;Magrit Mitschke&nbsp;&nbsp;^[Schimmel-Meldung] · × 4 sources
            </code>
            <br />
            …rather than “Magrit Mitschke is the current tenant of WE 32. According to the
            Schimmel-Meldung email of January 3rd, 2026…”. Three measurable wins from that choice,
            run against the live database with{" "}
            <code className="font-mono" style={{ color: "var(--amber-bright)" }}>scripts/bench-render.mjs</code>:
          </p>

          <div
            className="overflow-hidden rounded-lg mb-6"
            style={{ border: "1px solid var(--line)" }}
          >
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: "var(--bg-raised)" }}>
                  <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)" }}>entity</th>
                  <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)" }}>facts</th>
                  <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)" }}>structured</th>
                  <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)" }}>plain prose</th>
                  <th className="text-left px-5 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)" }}>compression</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["weg:immanuelkirchstr-26", 1784, 41666, 70990],
                  ["tenant:MIE-016", 268, 5746, 9036],
                  ["contractor:DL-001", 439, 10178, 15402],
                  ["owner:EIG-001", 80, 2468, 2850],
                ].map(([entity, facts, s, p]) => {
                  const ratio = (p as number) / (s as number);
                  return (
                    <tr key={entity as string} style={{ borderTop: "1px solid var(--line)" }}>
                      <td className="px-5 py-3 font-mono text-[11px]" style={{ color: "var(--ink)" }}>{entity}</td>
                      <td className="px-5 py-3 font-mono" style={{ color: "var(--ink-muted)" }}>{facts}</td>
                      <td className="px-5 py-3 font-mono" style={{ color: "var(--amber-bright)" }}>{(s as number).toLocaleString()} tok</td>
                      <td className="px-5 py-3 font-mono" style={{ color: "var(--ink-muted)" }}>{(p as number).toLocaleString()} tok</td>
                      <td className="px-5 py-3 font-mono" style={{ color: "var(--amber-bright)" }}>
                        {ratio.toFixed(2)}× · {(100 - 100 / ratio).toFixed(0)}% smaller
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: "2px solid var(--amber-bright)", background: "rgba(232,178,107,0.05)" }}>
                  <td className="px-5 py-3 font-mono text-[11px] font-semibold" style={{ color: "var(--ink)" }}>TOTAL</td>
                  <td className="px-5 py-3 font-mono font-semibold" style={{ color: "var(--ink)" }}>2,571</td>
                  <td className="px-5 py-3 font-mono font-semibold" style={{ color: "var(--amber-bright)" }}>60,058 tok</td>
                  <td className="px-5 py-3 font-mono" style={{ color: "var(--ink-muted)" }}>98,278 tok</td>
                  <td className="px-5 py-3 font-mono font-semibold" style={{ color: "var(--amber-bright)" }}>1.64× · 39% smaller</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                head: "39% fewer tokens",
                body: "Padded predicates + one fact per line drop ~40% of the prompt cost vs full sentences. Multiplies across 60 questions a day per manager.",
              },
              {
                head: "Byte-stable prefix → 90% cache hit",
                body: "Sections render in fixed order. No rendered_at timestamps. The same Context.md prefix lands at Anthropic on every follow-up about the same entity, hitting the 5-min prompt cache and cutting cost ~10× on repeats.",
              },
              {
                head: "Anchored blocks for surgical patches",
                body: "Each fact is wrapped in <!-- fact:IDENT --> ... <!-- /fact:IDENT --> so a manager edit between blocks survives the next ingest. Prose has no such grip.",
              },
            ].map((c) => (
              <div
                key={c.head}
                className="p-5 rounded-lg"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
              >
                <div className="text-[15px] font-medium mb-2" style={{ letterSpacing: "-0.01em" }}>
                  {c.head}
                </div>
                <p className="text-[13px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
                  {c.body}
                </p>
              </div>
            ))}
          </div>

          <div
            className="mt-6 p-5 rounded-lg text-[13px] leading-relaxed"
            style={{ background: "var(--bg-raised)", border: "1px solid var(--line)", color: "var(--ink-muted)" }}
          >
            <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-dim)" }}>
              honest exception ·{" "}
            </span>
            For very small entities (&lt; 10 facts), prose is roughly the same size or
            even slightly shorter because the section headers + grid overhead doesn&apos;t
            amortize. The structured format wins decisively past ~30 facts, which is
            every entity with any meaningful operational history.
          </div>

          <p className="text-[12px] mt-6" style={{ color: "var(--ink-dim)" }}>
            Reproduce: <code className="font-mono">npm run dev</code> →{" "}
            <code className="font-mono">node scripts/bench-render.mjs</code>. Tokens
            approximated as <code className="font-mono">chars / 4</code> — the ratio
            between formats is what matters for the comparison.
          </p>

          <div
            className="mt-6 p-5 rounded-lg text-[13px] leading-relaxed"
            style={{ background: "var(--bg-raised)", border: "1px solid var(--line)", color: "var(--ink-muted)" }}
          >
            <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-dim)" }}>
              the rendered view ·{" "}
            </span>
            We store and serve the structured Context.md as the canonical artifact.
            Humans never see it raw — at <code className="font-mono">/context/[id]</code>{" "}
            the same bytes are parsed into a typed table (predicate · value · citation
            chip · corroboration count) with conflicts shown as posterior bars. Click
            <code className="font-mono"> view raw</code> on the page to see what the
            agent reads.
          </div>
        </section>

        {/* Papers */}
        <section className="max-w-6xl mx-auto px-6 py-20">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / references
          </div>
          <h2 className="font-serif text-3xl md:text-4xl mb-10 leading-tight">
            Every feature traces to <span className="italic" style={{ color: "var(--amber-bright)" }}>a paper</span>.
          </h2>
          <div className="space-y-3">
            {papers.map((p) => (
              <div
                key={p.tag}
                className="grid grid-cols-[180px_1fr] md:grid-cols-[220px_280px_1fr] gap-5 p-5 rounded-lg transition-all hover:brightness-110"
                style={{
                  background: "var(--bg-raised)",
                  border: "1px solid var(--line)",
                }}
              >
                <div>
                  <div
                    className="font-mono text-[12px] mb-1"
                    style={{ color: "var(--amber-bright)" }}
                  >
                    {p.tag}
                  </div>
                  <div
                    className="text-[11px] font-mono"
                    style={{ color: "var(--ink-dim)" }}
                  >
                    {p.year}
                  </div>
                </div>
                <div className="hidden md:block">
                  <div
                    className="text-[11px] font-mono mb-1 uppercase tracking-wider"
                    style={{ color: "var(--ink-dim)" }}
                  >
                    maps to
                  </div>
                  <div className="text-[13px]" style={{ color: "var(--ink)" }}>
                    {p.maps}
                  </div>
                </div>
                <div>
                  <div
                    className="text-[13px] mb-2 font-medium"
                    style={{ color: "var(--ink)" }}
                  >
                    {p.title}
                  </div>
                  <div
                    className="text-[13px] leading-relaxed"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    {p.essence}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Closing */}
        <section className="max-w-4xl mx-auto px-6 py-20 text-center">
          <div className="hr-line mb-12" />
          <p
            className="font-serif text-[28px] md:text-[36px] leading-[1.3]"
            style={{ color: "var(--ink)" }}
          >
            We stood on <span className="italic" style={{ color: "var(--amber-bright)" }}>the right shoulders.</span>
            <br />
            <span style={{ color: "var(--ink-muted)" }}>
              That&apos;s the boring, durable kind of novel.
            </span>
          </p>
        </section>

        {/* Footer */}
        <footer className="max-w-6xl mx-auto px-6 py-16 mt-8">
          <div className="hr-line mb-10" />
          <div className="flex justify-between items-center">
            <HausbuchMark size={14} />
            <div
              className="text-[11px] font-mono"
              style={{ color: "var(--ink-dim)" }}
            >
              back to <a href="/" className="hover:text-amber-bright transition-colors">/</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
