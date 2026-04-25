// path: src/app/graph/page.tsx
// path: src/app/graph/page.tsx
import { Nav } from "@/components/Nav";
import { HausbuchMark } from "@/components/HausbuchMark";
import { GraphView } from "@/components/GraphView";
import { VFSView } from "@/components/VFSView";

export const metadata = {
  title: "Hausbuch — graph & virtual file system",
  description:
    "Derived knowledge graph and virtual file system over the context base. " +
    "Satisfies the Qontext track's 'virtual file system + graph' requirement.",
};

export default function GraphPage() {
  return (
    <div className="relative z-10">
      <Nav />

      <section className="max-w-6xl mx-auto px-6 pt-20 pb-12">
        <div className="text-[11px] font-mono tracking-widest uppercase mb-6" style={{ color: "var(--ink-dim)" }}>
          / graph
        </div>
        <h1
          className="font-serif leading-[0.98] tracking-tight mb-6"
          style={{ fontSize: "clamp(2.5rem, 6vw, 4rem)" }}
        >
          Graph &amp; virtual file system.
        </h1>
        <p className="text-[16px] leading-relaxed max-w-3xl" style={{ color: "var(--ink-muted)" }}>
          The Qontext track asks for a virtual file system plus graph that makes the company
          legible to machines and humans. Hausbuch derives both from the fact store at read time —
          no separate graph DB, no schema maintenance, no drift. An edge exists because a fact
          says so. When the fact is superseded, the edge disappears.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="text-[11px] font-mono tracking-widest uppercase mb-4" style={{ color: "var(--ink-dim)" }}>
          / graph
        </div>
        <h2 className="font-serif text-3xl md:text-4xl mb-6 leading-tight">
          Entities + edges, <span className="italic" style={{ color: "var(--amber-bright)" }}>derived</span>.
        </h2>
        <p className="text-[14px] mb-8 max-w-3xl" style={{ color: "var(--ink-muted)" }}>
          Every edge is grounded in a specific fact with a source citation. Hover a node to
          highlight its relationships. Amber = property · blue = organization · green = person.
        </p>
        <div
          className="rounded-lg p-5"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
        >
          <GraphView />
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="text-[11px] font-mono tracking-widest uppercase mb-4" style={{ color: "var(--ink-dim)" }}>
          / virtual file system
        </div>
        <h2 className="font-serif text-3xl md:text-4xl mb-6 leading-tight">
          Context base, <span className="italic" style={{ color: "var(--amber-bright)" }}>as a filesystem</span>.
        </h2>
        <p className="text-[14px] mb-8 max-w-3xl" style={{ color: "var(--ink-muted)" }}>
          The same structured fact store, projected as a tree you can cd into. Each entity has
          its own <code className="font-mono" style={{ color: "var(--amber-bright)" }}>Context.md</code> plus{" "}
          <code className="font-mono" style={{ color: "var(--amber-bright)" }}>facts.json</code> plus a{" "}
          <code className="font-mono" style={{ color: "var(--amber-bright)" }}>sources/</code> directory listing every
          source record the facts came from. Click the ↗ to open the live endpoint.
        </p>
        <VFSView />
      </section>

      <section className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-[11px] font-mono tracking-widest uppercase mb-4" style={{ color: "var(--ink-dim)" }}>
          / design
        </div>
        <h2 className="font-serif text-2xl md:text-3xl mb-6 leading-tight">
          How the graph is <span className="italic" style={{ color: "var(--amber-bright)" }}>derived</span>.
        </h2>
        <p className="text-[14px] mb-4 leading-relaxed" style={{ color: "var(--ink-muted)" }}>
          Certain predicates introduce new typed entities:
        </p>
        <div
          className="rounded-lg p-5 font-mono text-[12px] leading-relaxed overflow-x-auto"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--line)", color: "var(--ink)" }}
        >
          <pre>{`// src/lib/graph.ts:29
const ENTITY_PREDICATES = [
  { predicate: "identity.owner",     makeId: v => \`organization:\${slug(v)}\`,
    relation: "owned_by",            kind: "organization" },
  { predicate: "tenancy.tenant",     makeId: v => \`person:\${slug(v)}\`,
    relation: "has_tenant",          kind: "person" },
  { predicate: "contact.manager",    makeId: v => \`organization:\${slug(v)}\`,
    relation: "managed_by",          kind: "organization" },
  { predicate: "contact.primary",    makeId: v => \`person:\${slug(v)}\`,
    relation: "contact",             kind: "person" },
];`}</pre>
        </div>
        <p className="text-[14px] mt-5 mb-3 leading-relaxed" style={{ color: "var(--ink-muted)" }}>
          Why derived, not stored separately:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-[15px]" style={{ color: "var(--ink-muted)" }}>
          <li>Edges can't drift from their grounding — they ARE the fact.</li>
          <li>Bitemporal facts give bitemporal edges for free. "What did the org chart look like on April 15th?" is the same query with <code className="font-mono" style={{ color: "var(--amber-bright)" }}>at_known</code>.</li>
          <li>Superseding a fact (new owner via new contract) automatically retires the old edge on next graph read. No cleanup cron.</li>
        </ul>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-10 mt-8">
        <div className="hr-line mb-8" />
        <div className="flex justify-between items-center">
          <HausbuchMark size={14} />
          <div className="flex gap-4 text-[11px] font-mono" style={{ color: "var(--ink-dim)" }}>
            <a href="/demo" className="hover:text-amber-bright transition-colors">/demo</a>
            <a href="/research" className="hover:text-amber-bright transition-colors">/research</a>
            <a href="/technical" className="hover:text-amber-bright transition-colors">/technical</a>
            <a href="/" className="hover:text-amber-bright transition-colors">home</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
