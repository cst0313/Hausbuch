// path: src/components/InteractiveFacts.tsx
"use client";

import { FactExplainPopover } from "./FactExplainPopover";

export function InteractiveFacts() {
  return (
    <div
      className="rounded-lg p-6 font-mono text-[13px] leading-loose relative"
      style={{
        background: "var(--bg-raised)",
        border: "1px solid var(--line)",
      }}
    >
      <div
        className="absolute top-3 right-3 text-[10px] font-mono uppercase tracking-wider"
        style={{ color: "var(--ink-dim)" }}
      >
        hover a fact ↓
      </div>

      <div style={{ color: "var(--ink-dim)" }} className="mb-3">
        # Context.md — Berliner Str. 42 · tenancy
      </div>

      <div className="mb-1" style={{ color: "var(--amber-bright)" }}>
        Current tenancy · Apt 3
      </div>

      <div>
        <span style={{ color: "var(--ink-muted)" }}>tenant:</span>{" "}
        <FactExplainPopover
          source="lease-2024-03.pdf · page 1"
          quote="Mieter: Anna Schmidt, geboren 1989, wohnhaft Berliner Str. 42, Apt 3"
          confidence={0.98}
          knownFrom="2024-03-01"
          validFrom="2024-03-01"
        >
          <span style={{ color: "var(--amber-bright)", fontWeight: 500 }}>Anna Schmidt</span>
        </FactExplainPopover>
        <span style={{ color: "var(--ink-dim)", fontSize: "0.82em" }}>
          {" "}^[lease-2024-03.pdf p.1]
        </span>
      </div>

      <div>
        <span style={{ color: "var(--ink-muted)" }}>rent.base:</span>{" "}
        <FactExplainPopover
          source="lease-2024-03.pdf · page 3"
          quote="Die monatliche Grundmiete beträgt EUR 1.500,00 (in Worten: eintausendfünfhundert)"
          confidence={0.99}
          knownFrom="2024-03-01"
          validFrom="2024-03-01"
          priorValues={[
            { date: "2020-06-15", value: "€1,200 / month" },
            { date: "2023-01-01", value: "€1,400 / month" },
            { date: "2024-03-01", value: "€1,500 / month ← current" },
          ]}
        >
          <span style={{ color: "var(--amber-bright)", fontWeight: 500 }}>€1,500 / month</span>
        </FactExplainPopover>
        <span style={{ color: "var(--ink-dim)", fontSize: "0.82em" }}>
          {" "}^[lease-2024-03.pdf p.3]
        </span>
      </div>

      <div className="mt-2">
        <span style={{ color: "var(--ink-muted)" }}>rent.next:</span>{" "}
        <span style={{ color: "#f0a868" }}>⚠ contested</span>
        <div className="pl-4 mt-1">
          <div style={{ color: "#f0a868" }}>
            → {" "}
            <FactExplainPopover
              source="email · landlord@müller.de · 2026-04-18"
              quote="Ab dem 1. Juni 2026 wird die monatliche Miete auf 1.800 EUR erhöht. Mit freundlichen Grüßen."
              confidence={0.91}
              knownFrom="2026-04-18"
              validFrom="2026-06-01"
            >
              <span style={{ color: "#f0a868" }}>€1,800 (eff. 2026-06-01)</span>
            </FactExplainPopover>
          </div>
          <div style={{ color: "#f0a868" }}>
            → {" "}
            <FactExplainPopover
              source="legal-memo-2026.pdf · §4"
              quote="Gemäß § Mietpreisbremse (BGB §556d) ist die zulässige Miete auf EUR 1.650,00 gedeckelt. Der vom Vermieter geforderte Betrag von EUR 1.800 ist nicht durchsetzbar."
              confidence={0.95}
              knownFrom="2026-04-22"
              validFrom="2026-06-01"
            >
              <span style={{ color: "#f0a868" }}>€1,650 (per §Mietpreisbremse)</span>
            </FactExplainPopover>
          </div>
          <div className="text-[11px] pt-2" style={{ color: "var(--ink-dim)" }}>
            posterior: P(€1,650)=0.90 · P(€1,800)=0.10 · via Dawid-Skene (1979)
          </div>
        </div>
      </div>

      <div
        className="mt-6 pt-3 text-[11px] flex items-center justify-between"
        style={{ borderTop: "1px solid var(--line)", color: "var(--ink-dim)" }}
      >
        <span>every fact cites a span · hover for proof</span>
        <span className="font-mono">source-monitoring · Johnson 1993</span>
      </div>
    </div>
  );
}
