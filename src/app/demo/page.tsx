// path: src/app/demo/page.tsx
import { Nav } from "@/components/Nav";
import { LumenMark } from "@/components/LumenMark";
import { DemoConsole } from "@/components/DemoConsole";

export default function DemoPage() {
  return (
    <>
      <div className="relative z-10">
        <Nav />

        <section className="max-w-7xl mx-auto px-6 pt-14 pb-6">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-4"
            style={{ color: "var(--ink-dim)" }}
          >
            / demo
          </div>
          <h1
            className="font-serif leading-[1.0] tracking-tight mb-4"
            style={{ fontSize: "clamp(2rem, 4vw, 3rem)" }}
          >
            Two agents. <span className="italic" style={{ color: "var(--amber-bright)" }}>One living document.</span>
          </h1>
          <p
            className="max-w-2xl text-[14px] leading-relaxed"
            style={{ color: "var(--ink-muted)" }}
          >
            Each stage is a real <code className="font-mono" style={{ color: "var(--ink)" }}>POST /api/ingest</code>.
            The DB grows. The document rewrites itself. Both agents re-query and stay coherent.
          </p>
        </section>

        <section className="max-w-7xl mx-auto px-6 pb-20">
          <DemoConsole />
        </section>

        <footer className="max-w-7xl mx-auto px-6 py-10">
          <div className="hr-line mb-8" />
          <div className="flex justify-between items-center">
            <LumenMark size={14} />
            <div className="text-[11px] font-mono" style={{ color: "var(--ink-dim)" }}>
              <a href="/research" className="hover:text-amber-bright transition-colors">
                see the ablation study →
              </a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
