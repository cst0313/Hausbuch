// path: src/app/research/page.tsx
import { Nav } from "@/components/Nav";
import { LumenMark } from "@/components/LumenMark";
import { BenchmarkTable } from "@/components/BenchmarkTable";
import { AblationMatrix } from "@/components/AblationMatrix";
import { ArchitectureDiagram } from "@/components/ArchitectureDiagram";

const papers = [
  {
    tag: "Snodgrass '99",
    title: "Developing Time-Oriented Database Applications in SQL",
    year: "1999",
    maps: "bitemporal fact store",
    essence: "Two time axes — valid-time (when a claim is true in the world) and transaction-time (when we recorded it). Lumen's known-time mirrors transaction-time. Grandparent of SQL:2011.",
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
    essence: "Even frontier models degrade sharply past ~32K tokens with distractors. Lumen's rendering at detail=3 targets ~2k tokens — well within the sweet spot for every model tested.",
  },
  {
    tag: "Self-RAG '23",
    title: "Asai et al. — Learning to Retrieve, Generate, Critique",
    year: "2023",
    maps: "attribution-grounded generation",
    essence: "Models trained to emit citations alongside generations are measurably more factual. Lumen requires citations at the storage layer; generation just surfaces them.",
  },
  {
    tag: "Generative Agents '23",
    title: "Park et al. — Interactive Simulacra of Human Behavior",
    year: "Stanford 2023",
    maps: "persistent, cumulative memory",
    essence: "Agents with memory streams exhibit coherent behavior across long horizons. Lumen extends this from per-agent to per-org: shared memory across all agents in the company.",
  },
  {
    tag: "Truth Discovery '16",
    title: "Li et al. — A Survey on Truth Discovery",
    year: "ACM SIGKDD 2016",
    maps: "multi-source reconciliation",
    essence: "Decade-long survey of the problem: given contradictory claims from imperfect sources, recover truth. Lumen's reconciler is a small instance of this family.",
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
    essence: "Main/external memory with page-in/out discipline. Lumen's detail=1..5 query knob is a related primitive at the org level, not the agent level.",
  },
  {
    tag: "Anthropic '24",
    title: "Prompt Caching — docs & pricing",
    year: "2024",
    maps: "cache-stable Context.md prefix",
    essence: "5-minute cache TTL, 90% cost reduction on hits. Lumen's renderer produces append-only documents with stable prefixes to maximize hit rate.",
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
            How do we <span className="italic" style={{ color: "var(--amber-bright)" }}>know it works?</span>
          </h1>
          <p
            className="max-w-2xl text-[17px] leading-relaxed"
            style={{ color: "var(--ink-muted)" }}
          >
            Three decades of database theory, five decades of truth-discovery statistics,
            and two years of LLM-context research. We didn&apos;t invent any of it. We
            synthesized it. Here&apos;s the evidence that it works — run the benchmark live,
            and read the papers that grounded each decision.
          </p>
        </section>

        {/* Scaling argument — architecture + live experiment */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / scaling · the architectural thesis
          </div>
          <h2 className="font-serif text-3xl md:text-4xl mb-4 leading-tight">
            Reconstructing reality at runtime <span className="italic" style={{ color: "var(--amber-bright)" }}>does not scale.</span>
          </h2>
          <p className="text-[14px] max-w-3xl mb-8 leading-relaxed" style={{ color: "var(--ink-muted)" }}>
            The Qontext track&apos;s premise: every AI agent in your company pulls from scattered
            sources on every call. With A agents, N sources, and Q questions that is
            <span className="font-mono" style={{ color: "#d68572" }}> O(A · N · Q)</span> re-extractions.
            Lumen replaces it with an ingest-once, read-many topology where query cost
            grows <em>additively</em>, not multiplicatively.
          </p>
          <ArchitectureDiagram />

          <div
            className="mt-8 p-5 rounded-lg text-[13px] leading-relaxed"
            style={{ background: "var(--bg-raised)", border: "1px solid var(--line)", color: "var(--ink-muted)" }}
          >
            <span className="font-mono text-[11px] uppercase tracking-wider" style={{ color: "var(--ink-dim)" }}>
              honesty note ·{" "}
            </span>
            The architectural claim is a math argument, not a measurement. A proper scaling study
            needs a large real corpus (public leases, ERP exports, anonymized Slack archives). We
            removed the synthetic-corpus scaling chart that used to live here — generating fake
            documents to show Lumen winning is circular. The real measurements you can audit are
            the 15-question benchmark and the 5-way ablation below, both run against the current
            (small, real) corpus.
          </div>
        </section>

        {/* Benchmark table */}
        <section className="max-w-6xl mx-auto px-6 py-12">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / benchmark
          </div>
          <h2 className="font-serif text-3xl md:text-4xl mb-3 leading-tight">
            Live eval · Lumen vs. <span className="italic" style={{ color: "var(--amber-bright)" }}>naive RAG</span> vs. long-context
          </h2>
          <p
            className="text-[14px] mb-10 max-w-2xl"
            style={{ color: "var(--ink-muted)" }}
          >
            Click run — rows evaluate in real time. Green dots are correct, warm dots
            are wrong. Lumen doesn&apos;t win every question; we show the losses too.
          </p>
          <BenchmarkTable />
        </section>

        {/* Ablations — live, measured */}
        <section className="max-w-6xl mx-auto px-6 py-20">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / ablation study · live measured
          </div>
          <h2 className="font-serif text-3xl md:text-4xl mb-4 leading-tight">
            Each feature <span className="italic" style={{ color: "var(--amber-bright)" }}>pulls weight.</span>
          </h2>
          <p
            className="text-[13px] max-w-2xl mb-10"
            style={{ color: "var(--ink-dim)" }}
          >
            We disable one feature at a time and rerun the 15-question benchmark. The numbers
            below are computed on demand — click run. Expand any row for question-level detail.
            Citations don&apos;t affect this benchmark&apos;s accuracy; they affect trust, which we note honestly.
          </p>
          <AblationMatrix />
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
            <LumenMark size={14} />
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
