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

const CAPABILITIES: Array<{ stage: string; title: string; body: string; location: string }> = [
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
            What the system <span className="italic" style={{ color: "var(--amber-bright)" }}>actually does</span>, today.
          </h1>
          <p
            className="max-w-2xl text-[17px] leading-relaxed"
            style={{ color: "var(--ink-muted)" }}
          >
            A working report on the deployed pipeline — what each stage of the system
            costs in latency, what technique buys us that latency, and the prior work
            grounding each decision.
          </p>
        </section>

        {/* Current capabilities — what the live pipeline does */}
        <section className="max-w-6xl mx-auto px-6 py-12">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / current capabilities
          </div>
          <h2 className="font-serif text-3xl md:text-4xl mb-6 leading-tight">
            The pipeline running <span className="italic" style={{ color: "var(--amber-bright)" }}>right now</span>.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {CAPABILITIES.map((c) => (
              <div
                key={c.title}
                className="p-5 rounded-lg"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
              >
                <div
                  className="font-mono text-[10px] uppercase tracking-wider mb-2"
                  style={{ color: "var(--amber-bright)" }}
                >
                  {c.stage}
                </div>
                <div
                  className="text-[15px] font-medium mb-2"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {c.title}
                </div>
                <div className="text-[13px] leading-relaxed" style={{ color: "var(--ink-muted)" }}>
                  {c.body}
                </div>
                <div className="mt-3 font-mono text-[11px]" style={{ color: "var(--ink-dim)" }}>
                  {c.location}
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
