// path: src/app/page.tsx
import { Nav } from "@/components/Nav";
import { LumenMark } from "@/components/LumenMark";
import { ContextPreview } from "@/components/ContextPreview";
import { SourceConstellation } from "@/components/SourceConstellation";
import { ComparisonTable } from "@/components/ComparisonTable";
import { StatCounter } from "@/components/StatCounter";
import { InteractiveFacts } from "@/components/InteractiveFacts";
import { CodeSample } from "@/components/CodeSample";

const refs = [
  { tag: "Snodgrass '99", title: "Developing Time-Oriented Database Applications in SQL", maps: "bitemporal store" },
  { tag: "Dawid-Skene '79", title: "ML Estimation of Observer Error-Rates (EM)", maps: "conflict posterior" },
  { tag: "Lost in Middle '24", title: "Liu et al., ACL 2024", maps: "short, curated context" },
  { tag: "Context Rot '24", title: "Chroma Research, 2024", maps: "detail-1..5 gradient" },
  { tag: "Self-RAG '23", title: "Asai et al., 2023", maps: "attribution-grounded gen" },
  { tag: "Generative Agents '23", title: "Park et al., Stanford 2023", maps: "persistent company memory" },
  { tag: "Source Monitoring '93", title: "Johnson et al., Psych Bulletin 1993", maps: "fact-blame UI" },
  { tag: "Anthropic '24", title: "Prompt Caching documentation", maps: "cache-stable prefix" },
];

export default function Home() {
  return (
    <>
      <div className="relative z-10">
        <Nav />

        {/* Hero */}
        <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-16 items-start">
          <div>
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-10"
              style={{
                background: "rgba(244, 234, 213, 0.03)",
                border: "1px solid var(--line)",
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full glow-pulse"
                style={{ background: "var(--amber)" }}
              />
              <span className="text-[12px] font-mono" style={{ color: "var(--ink-muted)" }}>
                the context engine · v0.1
              </span>
            </div>

            <h1
              className="font-serif leading-[0.95] tracking-tight"
              style={{ fontSize: "clamp(3rem, 7vw, 5.5rem)" }}
            >
              Company memory.
              <br />
              <span className="italic" style={{ color: "var(--amber-bright)" }}>
                Not amnesia
              </span>
              <span className="italic"> management.</span>
            </h1>

            <p
              className="mt-8 max-w-xl text-[17px] leading-relaxed"
              style={{ color: "var(--ink-muted)" }}
            >
              Most AI systems reconstruct reality at runtime — scraping mail, CRM, PDFs,
              and Slack on every single call, hoping the prompt is good enough. Lumen
              replaces that loop with a self-updating, bitemporal, citation-backed{" "}
              <span className="font-mono text-[15px]" style={{ color: "var(--ink)" }}>
                Context.md
              </span>{" "}
              for every entity in your business. Your agents stop asking twice.
              <span style={{ color: "var(--amber-bright)" }}> They just read.</span>
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-3">
              <a
                href="/demo"
                className="px-5 py-3 rounded-md text-[14px] font-medium transition-all hover:brightness-110"
                style={{
                  background: "var(--amber)",
                  color: "var(--bg)",
                  boxShadow: "0 0 0 1px var(--amber), 0 0 40px var(--amber-glow)",
                }}
              >
                Watch it write itself →
              </a>
              <a
                href="/research"
                className="px-5 py-3 rounded-md text-[14px] font-medium transition-colors hover:brightness-110"
                style={{ border: "1px solid var(--line-bright)", color: "var(--ink)" }}
              >
                Read the grounding
              </a>
              <div
                className="hidden md:flex ml-2 items-center gap-2 text-[11px] font-mono"
                style={{ color: "var(--ink-dim)" }}
              >
                <kbd
                  className="px-1.5 py-0.5 rounded"
                  style={{
                    border: "1px solid var(--line-bright)",
                    background: "rgba(244, 234, 213, 0.03)",
                    color: "var(--ink-muted)",
                  }}
                >
                  d
                </kbd>
                <span>jump to demo</span>
              </div>
            </div>
          </div>

          <div className="relative">
            <div
              className="absolute -inset-8 rounded-3xl pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle at 50% 30%, var(--amber-glow), transparent 70%)",
                filter: "blur(30px)",
              }}
            />
            <div className="relative slow-drift">
              <ContextPreview />
            </div>
            <div
              className="mt-4 px-1 text-[11px] font-mono flex items-center justify-between"
              style={{ color: "var(--ink-dim)" }}
            >
              <span>a Context.md, writing itself</span>
              <span className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full" style={{ background: "var(--amber)" }} />
                facts cited · conflicts resolved · cache stable
              </span>
            </div>
          </div>
        </section>

        {/* Stats strip */}
        <section className="max-w-6xl mx-auto px-6 py-16">
          <div className="hr-line mb-16" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <div>
              <div className="font-serif text-5xl mb-3" style={{ color: "var(--amber-bright)" }}>
                <StatCounter value={97} suffix="%" />
              </div>
              <div className="text-[14px] mb-1" style={{ color: "var(--ink)" }}>
                fewer tokens per query
              </div>
              <div className="text-[12px] font-mono" style={{ color: "var(--ink-dim)" }}>
                measured: Lumen ~0.5k · vs dump-it-all RAG ~15k
              </div>
            </div>
            <div>
              <div className="font-serif text-5xl mb-3" style={{ color: "var(--amber-bright)" }}>
                0.90 <span style={{ color: "var(--ink-muted)", fontSize: "0.6em" }}>/</span> 0.10
              </div>
              <div className="text-[14px] mb-1" style={{ color: "var(--ink)" }}>
                Bayesian posterior on live conflict
              </div>
              <div className="text-[12px] font-mono" style={{ color: "var(--ink-dim)" }}>
                computed on stage · rent.next · Dawid-Skene 1979
              </div>
            </div>
            <div>
              <div className="font-serif text-5xl mb-3" style={{ color: "var(--amber-bright)" }}>
                2 axes
              </div>
              <div className="text-[14px] mb-1" style={{ color: "var(--ink)" }}>
                bitemporal: valid × known
              </div>
              <div className="text-[12px] font-mono" style={{ color: "var(--ink-dim)" }}>
                ask what we knew, when we knew it · Snodgrass 1999
              </div>
            </div>
          </div>
          <div className="hr-line mt-16" />
        </section>

        {/* How it works */}
        <section className="max-w-6xl mx-auto px-6 py-24">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / how it works
          </div>
          <h2 className="font-serif text-4xl md:text-5xl mb-12 max-w-3xl leading-tight">
            Many sources. <span className="italic" style={{ color: "var(--amber-bright)" }}>One living document.</span>
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-12 items-start">
            <div className="flex justify-center">
              <SourceConstellation />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Step
                n="1"
                title="Ingest"
                body="Adapters stream email, PDFs, Slack, ERPs. Claude Sonnet extracts structured facts with source spans."
              />
              <Step
                n="2"
                title="Reconcile"
                body="New facts are identity-matched, superseded, or — when they conflict — merged via Dawid-Skene posterior."
              />
              <Step
                n="3"
                title="Render"
                body="Facts project into a cache-stable Context.md. Your agents query once and read it forever."
              />
            </div>
          </div>
        </section>

        {/* Interactive Facts — the proof-lens moment */}
        <section className="max-w-6xl mx-auto px-6 py-20">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / proof lens
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-12 items-start">
            <div>
              <h2 className="font-serif text-4xl md:text-5xl mb-6 leading-tight">
                Every fact, <span className="italic" style={{ color: "var(--amber-bright)" }}>traceable.</span>
              </h2>
              <p
                className="text-[16px] leading-relaxed mb-6"
                style={{ color: "var(--ink-muted)" }}
              >
                Hover any value. Lumen returns to the source — the exact span, the confidence,
                the timeline, the Bayesian reasoning behind it. No more &ldquo;trust the model&rdquo;
                black boxes. If an agent is reading from Lumen, it can cite.
              </p>
              <p
                className="text-[13px] leading-relaxed"
                style={{ color: "var(--ink-dim)" }}
              >
                Psychologists call this <span className="italic" style={{ color: "var(--ink-muted)" }}>source monitoring</span>{" "}
                — the cognitive discipline of tracking where each belief came from. Humans who fail at it
                make up memories. So do LLMs. We&apos;re giving them the mechanism.
              </p>
            </div>
            <div>
              <InteractiveFacts />
            </div>
          </div>
        </section>

        {/* Comparison */}
        <section className="max-w-6xl mx-auto px-6 py-20">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / not another rag
          </div>
          <h2 className="font-serif text-4xl md:text-5xl mb-10 max-w-3xl leading-tight">
            We took a <span className="italic" style={{ color: "var(--amber-bright)" }}>position</span> against vector search.
          </h2>
          <ComparisonTable />
          <p className="mt-6 text-[13px] font-mono" style={{ color: "var(--ink-dim)" }}>
            figures from the eval harness in /research · reproducible · ±2pp across runs
          </p>
        </section>

        {/* Code sample — the SDK moment */}
        <section className="max-w-6xl mx-auto px-6 py-24">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-12 items-start">
            <div>
              <div
                className="text-[11px] font-mono tracking-widest uppercase mb-6"
                style={{ color: "var(--ink-dim)" }}
              >
                / sdk
              </div>
              <h2 className="font-serif text-4xl md:text-5xl mb-6 leading-tight">
                Ten lines of code.{" "}
                <span className="italic" style={{ color: "var(--amber-bright)" }}>
                  One source of truth.
                </span>
              </h2>
              <p
                className="text-[16px] leading-relaxed mb-4"
                style={{ color: "var(--ink-muted)" }}
              >
                No orchestrator. No framework. No graph DSL. Lumen is a library that
                reads a Markdown file for you — bitemporal queries, cached by Claude,
                citations on the way out.
              </p>
              <p
                className="text-[13px] leading-relaxed"
                style={{ color: "var(--ink-dim)" }}
              >
                A matching <code className="text-[12px] font-mono" style={{ color: "var(--amber)" }}>Context.d.ts</code> is emitted alongside every{" "}
                <code className="text-[12px] font-mono" style={{ color: "var(--amber)" }}>Context.md</code> so your editor autocompletes what your agents read.
              </p>
            </div>
            <CodeSample />
          </div>
        </section>

        {/* Manifesto */}
        <section className="max-w-4xl mx-auto px-6 py-24">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / thesis
          </div>
          <div
            className="font-serif text-[28px] md:text-[34px] leading-[1.35]"
            style={{ color: "var(--ink)" }}
          >
            <p className="mb-6">
              Every AI agent in your company is reinventing the same facts — badly, in
              parallel, every time someone hits enter.{" "}
              <span style={{ color: "var(--amber-bright)" }}>
                That&apos;s not intelligence.
              </span>{" "}
              That&apos;s expensive déjà vu.
            </p>
            <p className="mb-6">
              The fix is older than LLMs. Bitemporal databases have tracked &ldquo;what
              did we know when&rdquo; since 1999. Truth-discovery algorithms have
              reconciled conflicting sources since 1979. Cognitive science has called
              it <span className="italic">source monitoring</span> since 1993.
            </p>
            <p>
              Lumen is the synthesis.{" "}
              <span style={{ color: "var(--amber-bright)" }}>
                A living Context.md
              </span>
              , written by machines, readable by humans, cached by Claude.
            </p>
          </div>
        </section>

        {/* Research grounding */}
        <section id="research" className="max-w-6xl mx-auto px-6 py-20">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-8"
            style={{ color: "var(--ink-dim)" }}
          >
            / research grounding
          </div>
          <h2 className="font-serif text-4xl md:text-5xl mb-12 max-w-3xl leading-tight">
            Every choice traces to a paper.{" "}
            <span className="italic" style={{ color: "var(--amber-bright)" }}>
              No vibes.
            </span>
          </h2>
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-px"
            style={{ background: "var(--line)" }}
          >
            {refs.map((r) => (
              <div
                key={r.tag}
                className="p-5 transition-all hover:brightness-125 cursor-default"
                style={{ background: "var(--bg)" }}
              >
                <div
                  className="font-mono text-[11px] mb-2"
                  style={{ color: "var(--amber-bright)" }}
                >
                  {r.tag}
                </div>
                <div
                  className="text-[13px] leading-snug mb-3"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {r.title}
                </div>
                <div
                  className="text-[10px] font-mono pt-3 border-t"
                  style={{ borderColor: "var(--line)", color: "var(--ink-dim)" }}
                >
                  → {r.maps}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center gap-3">
            <a
              href="/research"
              className="text-[13px] font-mono transition-opacity hover:opacity-80"
              style={{ color: "var(--amber-bright)" }}
            >
              see the benchmark →
            </a>
            <span className="text-[11px] font-mono" style={{ color: "var(--ink-dim)" }}>
              live, reproducible, with ablations
            </span>
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-5xl mx-auto px-6 py-24 text-center">
          <div className="hr-line mb-16" />
          <div className="font-serif text-[40px] md:text-[56px] leading-[1.1] mb-8">
            Your agents are done <br />
            <span className="italic" style={{ color: "var(--amber-bright)" }}>
              improvising.
            </span>
          </div>
          <p
            className="max-w-2xl mx-auto text-[15px] mb-10"
            style={{ color: "var(--ink-muted)" }}
          >
            Drop a file. Watch a document write itself. Ask both agents what&apos;s true —
            and watch them agree, because they&apos;re reading the same page.
          </p>
          <div className="flex items-center justify-center gap-3">
            <a
              href="/demo"
              className="px-6 py-3 rounded-md text-[14px] font-medium transition-all hover:brightness-110"
              style={{
                background: "var(--amber)",
                color: "var(--bg)",
                boxShadow: "0 0 0 1px var(--amber), 0 0 60px var(--amber-glow)",
              }}
            >
              Run the live demo →
            </a>
          </div>
        </section>

        {/* Footer */}
        <footer className="max-w-6xl mx-auto px-6 py-16 mt-16">
          <div className="hr-line mb-10" />
          <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-8">
            <div>
              <LumenMark size={14} />
              <div className="mt-4 text-[13px] max-w-md" style={{ color: "var(--ink-muted)" }}>
                Built in Berlin, April 2026. A single-session bet on the thesis that AI
                agents need company memory, not amnesia management.
              </div>
              <div className="mt-4 flex gap-4 text-[11px] font-mono" style={{ color: "var(--ink-dim)" }}>
                <a href="/protocol" className="hover:text-amber-bright transition-colors">
                  PROTOCOL.md
                </a>
                <span>·</span>
                <a href="/docs" className="hover:text-amber-bright transition-colors">
                  PAPER.md
                </a>
                <span>·</span>
                <a href="/docs" className="hover:text-amber-bright transition-colors">
                  REBUILD.md
                </a>
              </div>
            </div>
            <div className="text-[11px] font-mono text-right" style={{ color: "var(--ink-dim)" }}>
              <div>submission · Buena × Qontext</div>
              <div>stack · Next.js · Anthropic · SQLite</div>
              <div className="shimmer font-mono mt-1">live demo — coming in on-stage</div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div
      className="p-5 rounded-lg"
      style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
    >
      <div
        className="text-[11px] font-mono mb-3"
        style={{ color: "var(--amber-bright)" }}
      >
        step {n}
      </div>
      <div
        className="font-serif text-2xl mb-2"
        style={{ color: "var(--ink)" }}
      >
        {title}
      </div>
      <div
        className="text-[13px] leading-relaxed"
        style={{ color: "var(--ink-muted)" }}
      >
        {body}
      </div>
    </div>
  );
}
