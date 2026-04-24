// path: src/components/FactProvenanceDrawer.tsx
"use client";

import { useEffect } from "react";
import type { Fact, Source } from "@/lib/types";

type Props = {
  fact: Fact | null;
  source: Source | null;
  onClose: () => void;
};

export function FactProvenanceDrawer({ fact, source, onClose }: Props) {
  // ESC to close
  useEffect(() => {
    if (!fact) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fact, onClose]);

  const open = fact !== null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        className="fixed inset-0 z-40 transition-opacity"
        style={{
          background: "rgba(0,0,0,0.45)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transitionDuration: "200ms",
        }}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Fact provenance"
        className="fixed right-0 top-0 bottom-0 z-50 w-full md:w-[420px] overflow-y-auto transition-transform"
        style={{
          background: "var(--bg-elevated)",
          borderLeft: "1px solid var(--border)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transitionTimingFunction: "cubic-bezier(0.4,0,0.2,1)",
          transitionDuration: "250ms",
        }}
      >
        {fact && (
          <div className="p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p
                  className="text-[11px] font-mono uppercase tracking-wider mb-1"
                  style={{ color: "var(--fg-dim)" }}
                >
                  provenance
                </p>
                <h2
                  className="text-[18px] font-semibold tracking-tight"
                  style={{ color: "var(--fg)", letterSpacing: "-0.01em" }}
                >
                  {fact.predicate}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="h-8 w-8 rounded-md flex items-center justify-center transition-colors hover:bg-[color:var(--bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]"
                style={{ color: "var(--fg-muted)" }}
              >
                ✕
              </button>
            </div>

            {/* Value */}
            <Row label="value">
              <span className="font-medium" style={{ color: "var(--fg)" }}>
                {String(fact.value)}
                {fact.unit && (
                  <span
                    className="ml-1 text-[12px]"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    {fact.unit}
                  </span>
                )}
              </span>
            </Row>

            <Row label="confidence">
              <ConfidenceBar value={fact.confidence} />
            </Row>

            {/* Bitemporal */}
            <Row label="valid time">
              <span className="font-mono text-[13px]" style={{ color: "var(--fg)" }}>
                {fact.valid_from ?? "—"} → {fact.valid_to ?? "open"}
              </span>
            </Row>
            <Row label="known time">
              <span className="font-mono text-[13px]" style={{ color: "var(--fg)" }}>
                {fact.known_from} → {fact.known_to ?? "open"}
              </span>
            </Row>

            {fact.superseded_by && (
              <Row label="superseded by">
                <span className="font-mono text-[12px]" style={{ color: "var(--warning)" }}>
                  {fact.superseded_by}
                </span>
              </Row>
            )}

            {/* Source */}
            <div
              className="mt-6 pt-6 border-t"
              style={{ borderColor: "var(--border)" }}
            >
              <p
                className="text-[11px] font-mono uppercase tracking-wider mb-3"
                style={{ color: "var(--fg-dim)" }}
              >
                source
              </p>
              {source ? (
                <>
                  <p
                    className="text-[14px] font-medium mb-1"
                    style={{ color: "var(--fg)" }}
                  >
                    {source.title}
                  </p>
                  <p
                    className="text-[11px] font-mono mb-4"
                    style={{ color: "var(--fg-dim)" }}
                  >
                    {source.kind} · ingested {source.ingested_at}
                  </p>
                  <blockquote
                    className="text-[13px] italic leading-relaxed pl-3 border-l-2"
                    style={{
                      borderColor: "var(--brand)",
                      color: "var(--fg-muted)",
                      fontFamily: "var(--font-serif)",
                    }}
                  >
                    “{source.raw_excerpt.slice(0, 280)}
                    {source.raw_excerpt.length > 280 ? "…" : ""}”
                  </blockquote>

                  {fact.span && (
                    <div
                      className="mt-4 text-[11px] font-mono"
                      style={{ color: "var(--fg-dim)" }}
                    >
                      span [{fact.span.start}:{fact.span.end}] · source_prior{" "}
                      {source.source_prior.toFixed(2)}
                    </div>
                  )}
                </>
              ) : (
                <p style={{ color: "var(--fg-muted)" }}>Source not found.</p>
              )}
            </div>

            {/* Fact id (dev helper) */}
            <div
              className="mt-6 pt-4 border-t text-[10px] font-mono"
              style={{ borderColor: "var(--border)", color: "var(--fg-dim)" }}
            >
              {fact.id}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2.5 flex items-start justify-between gap-4 border-b"
      style={{ borderColor: "var(--border)" }}>
      <span
        className="text-[11px] font-mono uppercase tracking-wider shrink-0"
        style={{ color: "var(--fg-dim)" }}
      >
        {label}
      </span>
      <span className="text-right text-[13px]">{children}</span>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.8
      ? "var(--success)"
      : value >= 0.5
        ? "var(--brand-tint)"
        : "var(--warning)";
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="w-16 h-1 rounded-full overflow-hidden"
        style={{ background: "var(--border-muted)" }}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
      <span className="font-mono text-[12px]" style={{ color: "var(--fg)" }}>
        {pct}%
      </span>
    </span>
  );
}
