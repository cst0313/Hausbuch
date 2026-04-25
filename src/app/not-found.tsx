// path: src/app/not-found.tsx
import Link from "next/link";
import { Nav } from "@/components/Nav";

export default function NotFound() {
  return (
    <>
      <div className="relative z-10">
        <Nav />
        <section className="max-w-3xl mx-auto px-6 pt-32 pb-20 text-center">
          <div
            className="text-[11px] font-mono tracking-widest uppercase mb-6"
            style={{ color: "var(--ink-dim)" }}
          >
            / 404 · fact not found
          </div>
          <h1
            className="font-serif leading-[0.95] mb-8"
            style={{ fontSize: "clamp(3rem, 7vw, 5.5rem)" }}
          >
            No <span className="italic" style={{ color: "var(--amber-bright)" }}>citation</span> for that.
          </h1>
          <div
            className="rounded-lg p-6 font-mono text-[13px] leading-relaxed mb-10 text-left inline-block mx-auto"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--line)",
              color: "var(--ink-muted)",
            }}
          >
            <div style={{ color: "var(--ink-dim)" }}>&gt; hausbuch query</div>
            <div>
              <span style={{ color: "var(--ink-muted)" }}>predicate:</span>{" "}
              <span style={{ color: "var(--amber-bright)" }}>page.exists</span>
            </div>
            <div>
              <span style={{ color: "var(--ink-muted)" }}>value:</span>{" "}
              <span style={{ color: "#d68572" }}>false</span>
            </div>
            <div>
              <span style={{ color: "var(--ink-muted)" }}>confidence:</span>{" "}
              <span style={{ color: "var(--ink)" }}>1.00</span>
            </div>
            <div>
              <span style={{ color: "var(--ink-muted)" }}>source:</span>{" "}
              <span style={{ color: "var(--ink)" }}>HTTP 404</span>
            </div>
            <div style={{ color: "var(--ink-dim)", marginTop: "0.5rem" }}>
              # no conflict to resolve. route simply does not exist.
            </div>
          </div>
          <p
            className="text-[15px] mb-10 max-w-xl mx-auto"
            style={{ color: "var(--ink-muted)" }}
          >
            Hausbuch wouldn&apos;t invent a page to be helpful. If it isn&apos;t here, it isn&apos;t.
            Try one of these, which verifiably are.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/"
              className="px-5 py-3 rounded-md text-[14px] font-medium transition-all hover:brightness-110"
              style={{
                background: "var(--amber)",
                color: "var(--bg)",
                boxShadow: "0 0 40px var(--amber-glow)",
              }}
            >
              ← home
            </Link>
            <Link
              href="/demo"
              className="px-5 py-3 rounded-md text-[14px] font-medium transition-colors"
              style={{ border: "1px solid var(--line-bright)", color: "var(--ink)" }}
            >
              /demo
            </Link>
            <Link
              href="/research"
              className="px-5 py-3 rounded-md text-[14px] font-medium transition-colors"
              style={{ border: "1px solid var(--line-bright)", color: "var(--ink)" }}
            >
              /research
            </Link>
            <Link
              href="/protocol"
              className="px-5 py-3 rounded-md text-[14px] font-medium transition-colors"
              style={{ border: "1px solid var(--line-bright)", color: "var(--ink)" }}
            >
              /protocol
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
