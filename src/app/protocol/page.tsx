// path: src/app/protocol/page.tsx
import { Nav } from "@/components/Nav";
import { HausbuchMark } from "@/components/HausbuchMark";

export default function ProtocolPage() {
  return (
    <>
      <div className="relative z-10">
        <Nav />

        <section className="max-w-3xl mx-auto px-6 pt-20 pb-16">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / protocol · v0.1
          </div>
          <h1
            className="font-serif leading-[0.98] tracking-tight mb-6"
            style={{ fontSize: "clamp(2.5rem, 6vw, 4.2rem)" }}
          >
            The{" "}
            <span className="font-mono" style={{ color: "var(--amber-bright)", fontSize: "0.88em" }}>
              Context.md
            </span>{" "}
            <span className="italic" style={{ color: "var(--amber-bright)" }}>
              protocol
            </span>
          </h1>
          <p
            className="text-[16px] leading-relaxed mb-4"
            style={{ color: "var(--ink-muted)" }}
          >
            Hausbuch is a reference implementation of an open format — a living, bitemporal,
            citation-backed Markdown document for AI-agent consumption. Apache-2.0.
          </p>
          <div className="flex gap-3 mt-6 text-[12px] font-mono">
            <span
              className="px-2.5 py-1 rounded"
              style={{
                background: "rgba(232, 178, 107, 0.1)",
                color: "var(--amber-bright)",
                border: "1px solid rgba(232, 178, 107, 0.3)",
              }}
            >
              Apache-2.0
            </span>
            <span
              className="px-2.5 py-1 rounded"
              style={{
                background: "rgba(244, 234, 213, 0.04)",
                color: "var(--ink-muted)",
                border: "1px solid var(--line)",
              }}
            >
              v0.1 · berlin · apr 2026
            </span>
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-6 py-12">
          <h2 className="font-serif text-2xl md:text-3xl mb-4" style={{ color: "var(--ink)" }}>
            Design goals
          </h2>
          <ol
            className="space-y-3 text-[15px] leading-relaxed list-decimal pl-5"
            style={{ color: "var(--ink-muted)" }}
          >
            <li>
              <strong style={{ color: "var(--ink)" }}>Human-readable without tooling.</strong>{" "}
              Open in any Markdown viewer; readable in <code>cat</code>.
            </li>
            <li>
              <strong style={{ color: "var(--ink)" }}>LLM-cheap.</strong> Deterministic line
              ordering + stable prefixes keep the prompt cache hot.
            </li>
            <li>
              <strong style={{ color: "var(--ink)" }}>Verifiable.</strong> Every claim has a
              citation pointing to the source and a span.
            </li>
            <li>
              <strong style={{ color: "var(--ink)" }}>Bitemporal.</strong> Both valid-time
              and known-time are addressable.
            </li>
            <li>
              <strong style={{ color: "var(--ink)" }}>Lossy by choice.</strong> Archived and
              low-confidence facts hide by default, recover on demand.
            </li>
          </ol>
        </section>

        <section className="max-w-3xl mx-auto px-6 py-12">
          <h2 className="font-serif text-2xl md:text-3xl mb-4" style={{ color: "var(--ink)" }}>
            A minimal grammar
          </h2>
          <p className="text-[14px] mb-4" style={{ color: "var(--ink-muted)" }}>
            ABNF-flavored, with apologies to the standards body we didn&apos;t ask:
          </p>
          <pre
            className="rounded-lg p-5 font-mono text-[12px] leading-relaxed overflow-x-auto"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
            }}
          >
{`document       = header section+ trailer
header         = "# " title newline meta-lines newline
meta-lines     = ("> " kv-line newline)+
section        = heading newline (fact-line / conflict-block)+ newline
heading        = "## " label
fact-line      = key ":" space+ value space+ citation
citation       = "^[" source-ref "]"
source-ref     = source-id ( space predicate )?
conflict-block = key ":" newline
                 ("  → " value space+ citation newline)+
                 "  posterior: " posterior-line newline
posterior-line = "P(" value ")=" probability ("·" "P(" value ")=" probability)*
                 " · via Dawid-Skene (1979)"
probability    = "0." 1*2DIGIT
trailer        = "<!-- Hausbuch · " counts " · last write " timestamp " -->"`}
          </pre>
        </section>

        <section className="max-w-3xl mx-auto px-6 py-12">
          <h2 className="font-serif text-2xl md:text-3xl mb-4" style={{ color: "var(--ink)" }}>
            Example
          </h2>
          <pre
            className="rounded-lg p-5 font-mono text-[12px] leading-relaxed overflow-x-auto md-preview"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--line)",
            }}
          >
{`# Context.md — Berliner Str. 42 · Mitte · Berlin
> auto-generated by Hausbuch · entity:property:berliner-str-42
> rendered_at: 2026-04-23T14:02:07Z · generation: 41 · cache_key: ctx_7f31

## Identity
address:        Berliner Str. 42, 10178 Berlin ^[land-registry.pdf §1]
type:           residential · 6 units           ^[erp:buildings#b-4412]
owner:          Müller Immobilien GmbH          ^[contract-2024.pdf p.1]

## Current tenancy · Apt 3
tenant:         Anna Schmidt                    ^[lease-2024-03.pdf p.1]
rent.base:      €1,500 / month                  ^[lease-2024-03.pdf p.3]
rent.effective: €1,500 / month since 2024-03-01 ^[known_time=2024-03-01]

## ⚠ Conflicts
rent.next:
  → €1,800 (effective 2026-06-01)  ^[email:landlord@müller.de 2026-04-18]
  → €1,650 (per § Mietpreisbremse) ^[legal-memo-2026.pdf §4]
  posterior: P(€1,650)=0.90 · P(€1,800)=0.10 · via Dawid-Skene (1979)

<!-- Hausbuch · 41 facts · 7 sources · 2 conflicts · last write 2026-04-22T17:30Z -->`}
          </pre>
        </section>

        <section className="max-w-3xl mx-auto px-6 py-12">
          <h2 className="font-serif text-2xl md:text-3xl mb-4" style={{ color: "var(--ink)" }}>
            Bitemporal semantics
          </h2>
          <p
            className="text-[15px] leading-relaxed mb-4"
            style={{ color: "var(--ink-muted)" }}
          >
            Every render is taken from a point{" "}
            <code className="text-[13px]" style={{ color: "var(--amber-bright)" }}>
              (at_valid, at_known)
            </code>
            . Default is <code>(now, now)</code>. Combinations produce four distinct query modes:
          </p>
          <div
            className="grid grid-cols-1 md:grid-cols-2 gap-3"
          >
            {[
              {
                mode: "Current render",
                args: "(now, now)",
                meaning: "What we believe to be true today, with what we currently know.",
              },
              {
                mode: "Historical truth",
                args: "(2024-03-15, now)",
                meaning: "What was true in March 2024 — with everything we've since learned folded in.",
              },
              {
                mode: "Historical knowledge",
                args: "(now, 2026-04-15)",
                meaning: "What we'd have rendered on April 15th, even if newer facts now contradict.",
              },
              {
                mode: "Time capsule",
                args: "(2024-03-15, 2024-04-01)",
                meaning: "What we would have believed was true in mid-March, if we'd asked on April 1st.",
              },
            ].map((q) => (
              <div
                key={q.mode}
                className="p-4 rounded-lg"
                style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
              >
                <div className="font-mono text-[11px] mb-1" style={{ color: "var(--amber-bright)" }}>
                  {q.args}
                </div>
                <div className="text-[13px] font-medium mb-2" style={{ color: "var(--ink)" }}>
                  {q.mode}
                </div>
                <div className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                  {q.meaning}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-6 py-12">
          <h2 className="font-serif text-2xl md:text-3xl mb-4" style={{ color: "var(--ink)" }}>
            Why Markdown and not JSON?
          </h2>
          <ul
            className="space-y-3 text-[15px] leading-relaxed list-disc pl-5"
            style={{ color: "var(--ink-muted)" }}
          >
            <li>LLMs read Markdown at roughly the same cost as JSON but humans read it dramatically better.</li>
            <li>Markdown is git-diffable. Line-based diffs tell the story of evolving truth.</li>
            <li>
              The{" "}
              <code className="text-[13px] font-mono" style={{ color: "var(--amber-bright)" }}>
                ^[citation]
              </code>{" "}
              footnote is standard Pandoc; tooling exists already.
            </li>
            <li>
              Where types matter, Hausbuch emits a parallel{" "}
              <code className="text-[13px] font-mono" style={{ color: "var(--amber-bright)" }}>
                Context.d.ts
              </code>
              . Machine consumers get precision; everyone else reads prose.
            </li>
          </ul>
        </section>

        <section className="max-w-3xl mx-auto px-6 py-12">
          <h2 className="font-serif text-2xl md:text-3xl mb-4" style={{ color: "var(--ink)" }}>
            Versioning
          </h2>
          <p
            className="text-[15px] leading-relaxed"
            style={{ color: "var(--ink-muted)" }}
          >
            <code style={{ color: "var(--amber-bright)" }}>Context.md v0.1</code> is the
            protocol as of Berlin, April 2026. Breaking changes bump the minor version. The
            reference implementation is this repository. The spec is Apache-2.0. Send
            proposals.
          </p>
        </section>

        <footer className="max-w-3xl mx-auto px-6 py-16 mt-8">
          <div className="hr-line mb-8" />
          <div className="flex justify-between items-center">
            <HausbuchMark size={14} />
            <div className="flex gap-4 text-[11px] font-mono" style={{ color: "var(--ink-dim)" }}>
              <a href="/research" className="hover:text-amber-bright transition-colors">
                /research
              </a>
              <a href="/demo" className="hover:text-amber-bright transition-colors">
                /demo
              </a>
              <a href="/" className="hover:text-amber-bright transition-colors">
                /
              </a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
