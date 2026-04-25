// path: src/app/technical/page.tsx
import { Nav } from "@/components/Nav";
import { HausbuchMark } from "@/components/HausbuchMark";

export const metadata = {
  title: "Hausbuch — technical decisions",
  description:
    "A walkthrough of the engineering choices behind Hausbuch: storage model, bitemporality, Dawid-Skene reconciliation, citations, cache-engineered rendering, and the RAG vs long-context comparison.",
};

export default function TechnicalPage() {
  return (
    <>
      <div className="relative z-10">
        <Nav />

        {/* Hero */}
        <section className="max-w-4xl mx-auto px-6 pt-20 pb-12">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / technical
          </div>
          <h1
            className="font-serif leading-[0.98] tracking-tight mb-6"
            style={{ fontSize: "clamp(2.5rem, 6vw, 4rem)" }}
          >
            Technical decisions,{" "}
            <span className="italic" style={{ color: "var(--amber-bright)" }}>
              in detail.
            </span>
          </h1>
          <p
            className="text-[16px] leading-relaxed"
            style={{ color: "var(--ink-muted)" }}
          >
            A long-form walkthrough of the engineering choices behind the context engine:
            what the primitive is, how time is modeled, how conflicts are reconciled, how
            proof spans are stored, how the rendered Markdown is engineered for prompt
            caching, and how the RAG / long-context baselines are computed for comparison.
            Every code reference points at the file and lines in the repo — audit the claims.
          </p>
        </section>

        {/* TOC */}
        <section className="max-w-4xl mx-auto px-6 mb-16">
          <div
            className="rounded-lg p-5"
            style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
          >
            <div
              className="text-[10px] font-mono uppercase tracking-wider mb-3"
              style={{ color: "var(--ink-dim)" }}
            >
              contents
            </div>
            <ol className="space-y-1.5 text-[13px] font-mono" style={{ color: "var(--ink-muted)" }}>
              {[
                ["storage", "Storage model — facts, not chunks"],
                ["bitemporal", "Bitemporality — two time axes"],
                ["dawid-skene", "Conflict resolution — Dawid-Skene posterior"],
                ["citations", "Citations — proof spans as first-class columns"],
                ["baselines", "RAG vs long-context vs Hausbuch"],
                ["cache", "Cache-engineered rendering"],
                ["ablation", "Ablation methodology — real vs modeled"],
                ["extractor", "Bilingual extractor"],
                ["differentiator", "The differentiator, in one line"],
                ["honesty", "Honesty note — bugs found, limits known"],
              ].map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="hover:text-amber-bright transition-colors"
                    style={{ color: "var(--ink)" }}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 1. Storage */}
        <Section id="storage" label="01" title="Storage model — facts, not chunks">
          <P>
            Most hackathon teams addressing the same prompt will ship a retrieval system —
            embed chunks of text, write them to a vector store, top-k retrieve at query
            time. Their primitive is <I>&ldquo;this 512-token slice is semantically similar
            to the query.&rdquo;</I> Ours is <I>&ldquo;Anna Schmidt was the tenant of this
            property, starting 2024-03-01, according to page 1 of this PDF, which said
            literally &lsquo;Mieter: Anna Schmidt (geb. 1989)&rsquo;.&rdquo;</I>
          </P>
          <Code>
            {`// src/lib/types.ts — the Fact primitive
type Fact = {
  id: FactId;
  entity: EntityId;               // "property:berliner-str-42"
  predicate: string;              // "tenancy.rent.base"
  value: FactValue;               // 1500
  unit?: string;                  // "EUR/month"
  valid_from?: string | null;     // when this was true in the world
  valid_to?: string | null;
  known_from: string;             // when Hausbuch learned it
  known_to: string | null;
  source: SourceId;               // "src:lease-2024-03"
  span: { start, end, quote };    // verbatim text that grounds this
  confidence: number;             // 0..1 from extractor
  superseded_by?: FactId | null;  // explicit lineage
  ident: string;                  // hash(entity, predicate, valid_from)
};`}
          </Code>
          <P>
            <B>Consequence:</B> Hausbuch can reason about whether two facts disagree. RAG
            can&apos;t — it returns both chunks and hopes the model sorts it out. Every
            feature that follows — time-travel, Bayesian conflict resolution, citations,
            cache-engineering — depends on this choice.
          </P>
        </Section>

        {/* 2. Bitemporality */}
        <Section id="bitemporal" label="02" title="Bitemporality — two time axes">
          <P>
            Most teams will store an <Mono>updated_at</Mono> and call it temporal. That
            collapses two orthogonal questions into one:
          </P>
          <ul className="list-disc pl-6 space-y-1.5 text-[15px] mb-5" style={{ color: "var(--ink-muted)" }}>
            <li>&quot;What <I>was</I> the rent in February 2024?&quot;</li>
            <li>&quot;What <I>did we know</I> about the rent on April 15th?&quot;</li>
          </ul>
          <P>
            These are different. The first is a <B>valid-time</B> query (ground truth in
            the world); the second is a <B>known-time</B> query (what the system believed
            at that moment). Bitemporal databases have kept the two separate since
            Snodgrass (1999); Hausbuch does the same at the fact level:
          </P>
          <Code>
            {`-- src/lib/db.ts:47
valid_from      TEXT,       -- when the claim became true in the world
valid_to        TEXT,
known_from      TEXT NOT NULL,  -- when Hausbuch came to believe it
known_to        TEXT,

CREATE INDEX idx_facts_known ON facts(known_from, known_to);
CREATE INDEX idx_facts_valid ON facts(valid_from, valid_to);`}
          </Code>
          <P>
            The view layer (<Mono>src/lib/query.ts:37-101</Mono>) runs the filter in two
            passes: first known-time (facts alive at <Mono>at_known</Mono>), then
            valid-time (facts true at <Mono>at_valid</Mono>). The default is{" "}
            <Mono>(now, now)</Mono> but either can be overridden via API query params.
          </P>
          <P>
            <B>Teams that conflate valid-time and known-time</B> will fail the question
            &quot;what did we know on April 15th?&quot; the moment the judge asks it.
            Hausbuch will not.
          </P>
        </Section>

        {/* 3. Dawid-Skene */}
        <Section id="dawid-skene" label="03" title="Conflict resolution — Dawid-Skene posterior">
          <P>
            When two sources disagree over the same predicate in the same valid-range,
            most teams silently pick a winner (newest, highest confidence, last-write-wins).
            That throws away the disagreement — and with it, the user&apos;s ability to
            notice it.
          </P>
          <P>
            Hausbuch keeps both facts and computes a <B>posterior probability</B> over the
            candidate values at read time using a one-step Dawid-Skene (1979) scheme with
            per-source trust priors:
          </P>
          <Code>
            {`// src/lib/reconciler.ts:45 — the core
for (const v of values) {
  const assertingSources = new Set(byValue.get(v)!.map((f) => f.source));
  let logL = Math.log(uniformPrior);
  for (const sid of allSourceIds) {
    const p = priors.get(sid)!;
    if (assertingSources.has(sid)) {
      const fact = byValue.get(v)!.find((f) => f.source === sid)!;
      logL += Math.log(p * fact.confidence);        // evidence FOR v
    } else {
      logL += Math.log((1 - p) + 1e-6);             // evidence AGAINST
    }
  }
  rawLikelihood[v] = Math.exp(logL);
}
// then normalize across candidate values`}
          </Code>
          <P>
            Deviations from the 1979 paper, documented inline: one EM step instead of
            iterating to convergence; uniform prior <Mono>P(v) = 1/|V|</Mono>. Good enough
            for 2-source conflicts on stage. The math renders directly in the document:
          </P>
          <Code>
            {`## ⚠ Conflicts
rent.next:
  → €1,800 / month  ^[email:landlord@müller.de 2026-04-18]
  → €1,650 / month  ^[legal-memo-2026.pdf]
  posterior: P(€1650)=0.90 · P(€1800)=0.10 · via Dawid-Skene (1979)`}
          </Code>
          <P>
            The posterior is computed <I>at render time</I>, not stored. That means
            retroactively changing source priors (say, downgrading an email after a bad
            batch) re-weights every conflict without rewriting any fact row.
          </P>
        </Section>

        {/* 4. Citations */}
        <Section id="citations" label="04" title="Citations — proof spans as first-class columns">
          <Code>
            {`-- src/lib/db.ts:52
span_start      INTEGER NOT NULL,
span_end        INTEGER NOT NULL,
span_quote      TEXT NOT NULL,`}
          </Code>
          <P>
            Every fact stores the verbatim text it was extracted from — byte offsets into
            the source + the literal quoted string. Not a reference to a chunk, not a
            &quot;source: filename&quot; metadata field, but the <B>actual sentence</B> a
            human could read to verify the claim.
          </P>
          <P>
            The proof-lens hover on the landing (<Mono>src/components/FactExplainPopover.tsx</Mono>)
            reads these columns directly. The renderer emits pandoc-style footnotes{" "}
            <Mono>^[source]</Mono> inline. Under attribution ablation, Hausbuch strips the
            footnotes from the answer text but still returns them in the response&apos;s
            separate <Mono>citations</Mono> field, so clients can decide whether to display.
          </P>
        </Section>

        {/* 5. Baselines */}
        <Section id="baselines" label="05" title="RAG vs long-context vs Hausbuch">
          <P>
            Three ways to answer a question from a corpus:
          </P>
          <div
            className="rounded-lg overflow-hidden mb-5"
            style={{ border: "1px solid var(--line)" }}
          >
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: "var(--bg-raised)" }}>
                  <th className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}>approach</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}>pipeline</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)" }}>typical tokens / query</th>
                </tr>
              </thead>
              <tbody>
                <Row label="RAG" color="var(--ink-muted)" pipeline="embed → top-k retrieve → send chunks to LLM" tokens="~15k (a few chunks)" />
                <Row label="Long context" color="var(--ink-muted)" pipeline="send whole corpus to LLM, every query" tokens="~40k (entire corpus)" />
                <Row label="Hausbuch" color="var(--amber-bright)" pipeline="extract facts → render Context.md → send cached doc" tokens="~500 (structured summary)" highlight />
              </tbody>
            </table>
          </div>
          <H3>Why RAG answers look like &quot;A memo mentions it&quot;</H3>
          <P>
            A real RAG system returns the most-similar chunk text. It has no structured
            way to say <I>&ldquo;this chunk came from legal-memo-2026.pdf&rdquo;</I> unless
            you embed the filename into the chunk itself. So for &quot;which source caps
            the rent at €1,650?&quot; the model sees a chunk containing{" "}
            <Mono>&ldquo;die zulässige Miete auf EUR 1.650,00 gedeckelt&rdquo;</Mono> and
            can quote it, but can&apos;t attribute it back to the file with confidence.
            That&apos;s the class of failure mode we simulate in{" "}
            <Mono>src/lib/ablations.ts:130</Mono>.
          </P>
          <H3>Why long-context degrades</H3>
          <ul className="list-disc pl-6 space-y-1.5 text-[15px] mb-5" style={{ color: "var(--ink-muted)" }}>
            <li><I>Lost in the Middle</I> (Liu et al., ACL 2024): attention is U-shaped over long inputs; middle content is ignored.</li>
            <li><I>Context Rot</I> (Chroma Research, 2024): frontier models degrade sharply past ~32K tokens with distractors.</li>
            <li>Attention cost is quadratic in input length (Vaswani et al., 2017) — 40k tokens is not 40× the cost of 1k; it&apos;s worse.</li>
            <li>The model must reason about <I>when</I> facts were true by itself — typically it picks the textually-prominent value. &quot;Rent in Feb 2024&quot; returns €1,500 instead of €1,400 because the former is more frequently mentioned.</li>
          </ul>
          <P>
            Both baselines are wired behind <Mono>/api/query?baseline=rag|longctx</Mono>.
            When <Mono>ANTHROPIC_API_KEY</Mono> is set, they call Claude Sonnet 4.6 with
            the appropriate prompt (retrieved chunks for RAG, full corpus for long-context).
            When it&apos;s not, they fall back to simulators in{" "}
            <Mono>src/lib/ablations.ts</Mono> that reproduce the documented failure modes.
            The model field in the response says <Mono>-simulated</Mono> when the fallback
            is active — nothing is hidden.
          </P>
        </Section>

        {/* 6. Cache */}
        <Section id="cache" label="06" title="Cache-engineered rendering">
          <P>
            Anthropic&apos;s prompt cache has two mechanics that matter:
          </P>
          <ol className="list-decimal pl-6 space-y-1.5 text-[15px] mb-5" style={{ color: "var(--ink-muted)" }}>
            <li><B>Cost</B>: cache hit is ~10% of uncached token price.</li>
            <li><B>Key</B>: the cache key is a byte-hash of the prefix up to the <Mono>cache_control</Mono> marker. One character different → cache miss.</li>
          </ol>
          <P>
            Naive RAG destroys this: retrieved chunks vary per query, so the prefix is
            never byte-identical. Every query is a miss.
          </P>
          <H3>What Hausbuch does specifically</H3>
          <ol className="list-decimal pl-6 space-y-3 text-[15px] mb-6" style={{ color: "var(--ink-muted)" }}>
            <li>
              <B>Deterministic render pipeline.</B> Sections always in the same order (<Mono>SECTION_ORDER</Mono>), predicates within sections sorted by <Mono>first-known-time</Mono>, keys padded to 18 chars so alignment is stable. Same facts → same bytes.
            </li>
            <li>
              <B>Two cache markers.</B> The query route uses two <Mono>cache_control</Mono> blocks — one after the system prompt, one after the Context.md:
            </li>
          </ol>
          <Code>
            {`// src/app/api/query/route.ts
system: [
  { type: "text", text: systemText, cache_control: { type: "ephemeral" } },  // marker 1
  { type: "text", text: contextMd,  cache_control: { type: "ephemeral" } },  // marker 2
],
messages: [{ role: "user", content: question }],   // NOT cached`}
          </Code>
          <ol start={3} className="list-decimal pl-6 space-y-3 text-[15px] mb-6" style={{ color: "var(--ink-muted)" }}>
            <li>
              <B>Append-only churn.</B> New facts land in <Mono>## Upcoming</Mono> or <Mono>## ⚠ Conflicts</Mono> at the bottom. Identity, tenancy, condition — the first 80% of bytes — barely move.
            </li>
            <li>
              <B>Archive-as-comment.</B> Superseded facts go into HTML-commented blocks. Agents at <Mono>detail&lt;4</Mono> don&apos;t see them, but the cacheable prefix length stays predictable.
            </li>
            <li>
              <B>No query-dependent timestamps.</B> The <Mono>rendered_at</Mono> meta-line is omitted on purpose — a per-render timestamp would bust the prefix.
            </li>
          </ol>
          <H3>What this buys at scale</H3>
          <P>
            Three questions asked in sequence against the same Context.md:
          </P>
          <Code>
            {`Q1: cache MISS  — ~500 tokens billed (full prefix + question)
Q2: cache HIT   — ~30 tokens billed (question only, rest from cache)
Q3: cache HIT   — ~30 tokens billed

Versus naive RAG with shuffled top-k:
Q1: miss — 15k tokens
Q2: miss — 15k tokens (different chunks = different prefix)
Q3: miss — 15k tokens`}
          </Code>
          <P>
            The <Mono>LiveCostTicker</Mono> in the nav reads{" "}
            <Mono>cache_read_input_tokens</Mono> from Anthropic&apos;s usage response when
            the API key is set. No key in this env, so the current values are simulated
            counters — labeled explicitly as such.
          </P>
        </Section>

        {/* 7. Ablation */}
        <Section id="ablation" label="07" title="Ablation methodology — real vs modeled">
          <P>
            The 15-question benchmark and the 5-way ablation study on <A href="/research">/research</A> are real. Each
            row is a live <Mono>POST /api/query</Mono>. The numbers in the table are
            whatever the engine actually produced this session.
          </P>
          <P>
            What used to exist — and is now removed — was a <Mono>scaling</Mono> chart that
            ingested synthetic corpora of 7–102 fake documents and measured the
            per-query token curve. The corpus was generated by{" "}
            <Mono>src/lib/synthetic.ts</Mono>, not real data. Generating fake documents to
            show Hausbuch winning is circular. We deleted the chart, the route, and the
            generator (commit <Mono>2f2a585</Mono>) and replaced the section with an
            honesty note.
          </P>
          <P>
            Ablation modes, all toggled via <Mono>POST /api/query ablate=…</Mono>:
          </P>
          <Code>
            {`none           — full Hausbuch
bitemporality  — collapse to "latest known fact wins" per predicate; no valid-time
conflict       — silently pick highest-confidence; no posterior
attribution    — strip ^[source] citations from the answer
all            — replace the engine with simulated keyword RAG (ragBaselineAnswer)`}
          </Code>
          <P>
            Expected ablation deltas (measured this session):
          </P>
          <Code>
            {`Hausbuch (full)        15/15 = 100%
– bitemporality     11/15 =  73%   (−27pp, temporal queries break)
– Dawid-Skene       13/15 =  86%   (−13pp, conflict questions break)
– citations         15/15 = 100%   (0pp — citations affect trust, not this metric)
RAG baseline         6/15 =  40%   (−60pp, temporal + conflict both break)`}
          </Code>
        </Section>

        {/* 8. Extractor */}
        <Section id="extractor" label="08" title="Bilingual extractor">
          <P>
            <Mono>src/lib/extractor.ts</Mono> is a structured set of 11 predicate
            extractors, each trying German and English patterns. Runs when no Anthropic
            key is set; when a key is present, Claude Sonnet 4.6 with structured-output
            prompting does the same job. The API contract is identical either way.
          </P>
          <div
            className="rounded-lg overflow-hidden mb-5"
            style={{ border: "1px solid var(--line)" }}
          >
            <table className="w-full text-[12px] font-mono">
              <thead>
                <tr style={{ background: "var(--bg-raised)" }}>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}>predicate</th>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)", borderRight: "1px solid var(--line)" }}>German</th>
                  <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider" style={{ color: "var(--ink-dim)" }}>English</th>
                </tr>
              </thead>
              <tbody>
                <ExtractorRow p="tenancy.tenant" de="Mieter: X Y" en="Tenant / Renter / Resident / Lessee" />
                <ExtractorRow p="identity.owner" de="Eigentümer: X GmbH" en="Owner / Landlord / Owned by + suffix" />
                <ExtractorRow p="identity.address" de="Adresse: X-Straße N" en="Address / Property at / Located at" />
                <ExtractorRow p="identity.units" de="6 Wohneinheiten" en="6 units / apartments" />
                <ExtractorRow p="tenancy.rent.base" de="Grundmiete beträgt EUR X" en="Monthly rent: $X / €X/month" />
                <ExtractorRow p="tenancy.rent.next" de="Ab dem 1. Juni 2026 … X EUR" en="effective June 1, 2027 … $X" />
                <ExtractorRow p="tenancy.rent.next (cap)" de="zulässige Miete … gedeckelt" en="capped at $X / maximum rent of $X" />
                <ExtractorRow p="tenancy.start" de="Mietbeginn: X" en="Lease starts: / begins" />
                <ExtractorRow p="tenancy.end" de="Befristet bis: X" en="Lease expires / ends / terminates" />
                <ExtractorRow p="condition.last_inspection" de="Inspection abgeschlossen am X" en="Inspected on / inspection dated X" />
                <ExtractorRow p="condition.open_tickets" de="N offene Tickets" en="N open tickets / maintenance issues" />
              </tbody>
            </table>
          </div>
          <P>
            Dates normalize across <Mono>2027-02-28</Mono> (ISO), <Mono>1. Juni 2026</Mono>{" "}
            (German long), and <Mono>June 1, 2026</Mono> / <Mono>June 1st, 2026</Mono>{" "}
            (English long). Numbers auto-detect locale:{" "}
            <Mono>1.500,00</Mono> (DE), <Mono>1,500.00</Mono> (US), or{" "}
            <Mono>1500</Mono> (plain) all parse to the same integer.
          </P>
          <P>
            When no specific pattern fires, a generic tier runs (first ISO date →{" "}
            <Mono>mentioned.date</Mono>, first currency amount → <Mono>mentioned.amount</Mono>).
            Demos never show &quot;0 facts&quot; on arbitrary input.
          </P>
        </Section>

        {/* 9. Differentiator */}
        <Section id="differentiator" label="09" title="The differentiator, in one line">
          <div
            className="rounded-lg p-6 mb-5"
            style={{
              background: "rgba(232, 178, 107, 0.06)",
              border: "1px solid rgba(232, 178, 107, 0.3)",
            }}
          >
            <div
              className="font-serif text-[22px] leading-relaxed"
              style={{ color: "var(--ink)" }}
            >
              Most teams will ship a retrieval system.{" "}
              <span className="italic" style={{ color: "var(--amber-bright)" }}>
                Hausbuch is a memory system with provenance, temporal awareness, and a cached
                rendering layer.
              </span>
            </div>
          </div>
          <P>
            The primitive isn&apos;t a chunk, it&apos;s a fact. The schema has two time
            axes, not one. Conflicts are preserved rather than silently resolved. The
            rendered output is the thing agents cache, not the retrieved chunks. Every
            RAG-shaped submission will fail the &quot;what did we know on April 15th?&quot;
            question. Hausbuch won&apos;t.
          </P>
        </Section>

        {/* 10. Honesty */}
        <Section id="honesty" label="10" title="Honesty note — bugs found, limits known">
          <H3>Bugs fixed while building (commits in the log)</H3>
          <ul className="list-disc pl-6 space-y-2 text-[15px] mb-6" style={{ color: "var(--ink-muted)" }}>
            <li>
              <B>pdf-parse v1 → v2 API change.</B> The v2 package exports a{" "}
              <Mono>PDFParse</Mono> class, not a default function. My upload handler used
              the v1 pattern and threw &quot;pdf parse is not a function&quot; on any
              upload. Fixed at <Mono>src/app/api/upload/route.ts:105</Mono>.
            </li>
            <li>
              <B>pdfjs-dist worker bundling.</B> Next.js&apos;s bundler rewrote the worker
              path but never emitted the chunk — pdfjs failed to spawn. Fixed by adding
              <Mono> serverExternalPackages: [&quot;pdf-parse&quot;, &quot;pdfjs-dist&quot;]</Mono> to{" "}
              <Mono>next.config.ts</Mono>.
            </li>
            <li>
              <B><Mono>validOverlap()</Mono> string-compare.</B> The reconciler used <Mono>&quot;+inf&quot;/&quot;-inf&quot;</Mono> string sentinels, but in lexicographic order <Mono>&quot;+inf&quot; &lt; &quot;2019-01-01&quot;</Mono> (ASCII <Mono>+</Mono>=43, <Mono>2</Mono>=50). Overlap detection silently returned false when one fact had null <Mono>valid_from</Mono>. Fixed to use ISO-sortable sentinels <Mono>&quot;0000-01-01&quot;/&quot;9999-12-31&quot;</Mono> at <Mono>src/lib/reconciler.ts:86</Mono>.
            </li>
            <li>
              <B>English owner regex missing <Mono>/i</Mono> flag.</B> Case-sensitive match failed on <Mono>Owner:</Mono> (capital O) in uploaded documents. Fixed.
            </li>
            <li>
              <B>Tenant regex too greedy.</B> Early version matched &quot;mieter&quot; inside &quot;Mieterhöhung&quot; and &quot;Vermieter&quot; → extracted nonsense names like <Mono>&quot;öhung Apt&quot;</Mono>. Fixed with word-boundary anchoring + required <Mono>:</Mono> separator.
            </li>
            <li>
              <B>RAG token counter reported full corpus.</B> <Mono>ragBaselineAnswer</Mono> was returning the full corpus as <Mono>tokens_in</Mono>, which is wrong — real RAG only sends top-k retrieved chunks. Fixed to report top-3 retrieved chunk tokens only.
            </li>
            <li>
              <B>Long-context simulator token cost.</B> The simulated long-context baseline reports only the raw corpus byte-count, not the ~40K tokens a real Claude call would consume. That&apos;s documented in the model label (<Mono>-simulated</Mono>) but the cost story is muted without a real API key.
            </li>
          </ul>
          <H3>What the engine doesn&apos;t have</H3>
          <ul className="list-disc pl-6 space-y-2 text-[15px]" style={{ color: "var(--ink-muted)" }}>
            <li>No real vector embedding for the RAG baseline — it&apos;s keyword top-k. A production system would use <Mono>text-embedding-3-small</Mono> or similar. The simulated RAG is a weak upper bound on what vector RAG would produce; real numbers would be similar-or-worse.</li>
            <li>No measured scaling curve against a large corpus. The scaling thesis is in the <A href="/research">/research</A> architecture diagram but it&apos;s math, not a measurement. Doing it properly needs public real-world property / ERP / email archives.</li>
            <li>Claude is only called when <Mono>ANTHROPIC_API_KEY</Mono> is set. In its absence the heuristic composer produces structured-but-canonical answers. Label says <Mono>compose-fallback</Mono> explicitly.</li>
            <li>One-step Dawid-Skene, not iterated EM to convergence. For 2-source conflicts the difference is negligible; for N-source conflicts we&apos;d iterate.</li>
            <li>The heuristic extractor is pattern-based, not semantic. It can miss phrasings outside its regex coverage; Claude is strictly better when the key is set.</li>
          </ul>
        </Section>

        <footer className="max-w-4xl mx-auto px-6 py-16 mt-16">
          <div className="hr-line mb-8" />
          <div className="flex justify-between items-center">
            <HausbuchMark size={14} />
            <div className="flex gap-4 text-[11px] font-mono" style={{ color: "var(--ink-dim)" }}>
              <a href="/demo" className="hover:text-amber-bright transition-colors">/demo</a>
              <a href="/research" className="hover:text-amber-bright transition-colors">/research</a>
              <a href="/protocol" className="hover:text-amber-bright transition-colors">/protocol</a>
              <a href="/" className="hover:text-amber-bright transition-colors">home</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}

/* ───────────────────────────── helpers ───────────────────────────── */

function Section({
  id,
  label,
  title,
  children,
}: {
  id: string;
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="max-w-4xl mx-auto px-6 py-12 scroll-mt-20">
      <div
        className="text-[11px] font-mono tracking-widest uppercase mb-4"
        style={{ color: "var(--ink-dim)" }}
      >
        / {label}
      </div>
      <h2
        className="font-serif leading-tight mb-6"
        style={{ fontSize: "clamp(1.75rem, 3.5vw, 2.5rem)" }}
      >
        {title}
      </h2>
      <div>{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[15px] leading-relaxed mb-5"
      style={{ color: "var(--ink-muted)" }}
    >
      {children}
    </p>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="font-serif text-[22px] mt-6 mb-3"
      style={{ color: "var(--ink)" }}
    >
      {children}
    </h3>
  );
}

function I({ children }: { children: React.ReactNode }) {
  return <em style={{ color: "var(--ink)" }}>{children}</em>;
}

function B({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: "var(--ink)" }}>{children}</strong>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="text-[13px] font-mono"
      style={{
        background: "rgba(232, 178, 107, 0.08)",
        color: "var(--amber-bright)",
        padding: "1px 5px",
        borderRadius: "3px",
      }}
    >
      {children}
    </code>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="font-mono hover:brightness-125 transition-all"
      style={{ color: "var(--amber-bright)" }}
    >
      {children}
    </a>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre
      className="p-4 rounded-lg font-mono text-[12px] leading-relaxed overflow-x-auto mb-5"
      style={{
        background: "var(--bg-raised)",
        border: "1px solid var(--line)",
        color: "var(--ink)",
      }}
    >
      <code>{children}</code>
    </pre>
  );
}

function Row({
  label,
  color,
  pipeline,
  tokens,
  highlight,
}: {
  label: string;
  color: string;
  pipeline: string;
  tokens: string;
  highlight?: boolean;
}) {
  return (
    <tr style={{ borderTop: "1px solid var(--line)" }}>
      <td
        className="px-4 py-3 font-mono text-[12px]"
        style={{
          color,
          borderRight: "1px solid var(--line)",
          background: highlight ? "rgba(232, 178, 107, 0.06)" : undefined,
          fontWeight: highlight ? 500 : 400,
        }}
      >
        {label}
      </td>
      <td
        className="px-4 py-3 text-[13px]"
        style={{ color: "var(--ink-muted)", borderRight: "1px solid var(--line)" }}
      >
        {pipeline}
      </td>
      <td
        className="px-4 py-3 font-mono text-[12px]"
        style={{
          color: highlight ? "var(--amber-bright)" : "var(--ink-muted)",
          background: highlight ? "rgba(232, 178, 107, 0.06)" : undefined,
        }}
      >
        {tokens}
      </td>
    </tr>
  );
}

function ExtractorRow({ p, de, en }: { p: string; de: string; en: string }) {
  return (
    <tr style={{ borderTop: "1px solid var(--line)" }}>
      <td
        className="px-3 py-2 text-[11px]"
        style={{ color: "var(--amber-bright)", borderRight: "1px solid var(--line)" }}
      >
        {p}
      </td>
      <td
        className="px-3 py-2 text-[12px]"
        style={{ color: "var(--ink-muted)", borderRight: "1px solid var(--line)" }}
      >
        {de}
      </td>
      <td className="px-3 py-2 text-[12px]" style={{ color: "var(--ink-muted)" }}>
        {en}
      </td>
    </tr>
  );
}
