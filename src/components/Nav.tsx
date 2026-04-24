// path: src/components/Nav.tsx
import Link from "next/link";
import { LumenMark } from "./LumenMark";
import { LiveCostTicker } from "./LiveCostTicker";

export function Nav() {
  return (
    <nav
      className="sticky top-0 z-40 backdrop-blur-md"
      style={{
        background: "rgba(10, 9, 8, 0.75)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="hover:opacity-80 transition-opacity">
          <LumenMark size={18} />
        </Link>
        <div className="flex items-center gap-6 text-[13px]">
          <Link href="/research" className="font-mono transition-colors hover:text-amber-bright" style={{ color: "var(--ink-muted)" }}>
            /research
          </Link>
          <Link href="/demo" className="font-mono transition-colors hover:text-amber-bright" style={{ color: "var(--ink-muted)" }}>
            /demo
          </Link>
          <Link href="/graph" className="font-mono transition-colors hover:text-amber-bright" style={{ color: "var(--ink-muted)" }}>
            /graph
          </Link>
          <Link href="/technical" className="font-mono transition-colors hover:text-amber-bright" style={{ color: "var(--ink-muted)" }}>
            /technical
          </Link>
          <Link href="/protocol" className="font-mono transition-colors hover:text-amber-bright" style={{ color: "var(--ink-muted)" }}>
            /protocol
          </Link>
          <LiveCostTicker />
          <span
            className="hidden lg:inline-flex px-2.5 py-1 rounded-full text-[11px] font-mono items-center gap-1.5"
            style={{
              background: "rgba(232, 178, 107, 0.1)",
              border: "1px solid rgba(232, 178, 107, 0.3)",
              color: "var(--amber-bright)",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full glow-pulse" style={{ background: "var(--amber)" }} />
            berlin · apr 2026
          </span>
        </div>
      </div>
    </nav>
  );
}
