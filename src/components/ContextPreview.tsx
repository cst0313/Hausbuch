// path: src/components/ContextPreview.tsx
"use client";

import { useEffect, useState } from "react";

type Line =
  | { kind: "heading"; text: string }
  | { kind: "blank" }
  | { kind: "fact"; key: string; value: string; cite: string }
  | { kind: "conflict"; key: string; a: string; b: string; cite_a: string; cite_b: string }
  | { kind: "comment"; text: string };

const script: Line[] = [
  { kind: "comment", text: "# Context.md — Berliner Str. 42 · Mitte · Berlin" },
  { kind: "blank" },
  { kind: "heading", text: "## Identity" },
  { kind: "fact", key: "address", value: "Berliner Str. 42, 10178 Berlin", cite: "land-registry.pdf §1" },
  { kind: "fact", key: "type", value: "residential · 6 units", cite: "erp:buildings#b-4412" },
  { kind: "fact", key: "owner", value: "Müller Immobilien GmbH", cite: "contract-2024.pdf p.1" },
  { kind: "blank" },
  { kind: "heading", text: "## Current tenancy · Apt 3" },
  { kind: "fact", key: "tenant", value: "Anna Schmidt", cite: "lease-2024-03.pdf p.1" },
  { kind: "fact", key: "rent.base", value: "€1,500 / month", cite: "lease-2024-03.pdf p.3" },
  { kind: "fact", key: "rent.effective", value: "€1,500 / month since 2024-03-01", cite: "known_time=2024-03-01" },
  {
    kind: "conflict",
    key: "rent.next",
    a: "€1,800 (effective 2026-06-01)",
    b: "€1,650 (cap per § Mietpreisbremse)",
    cite_a: "email:landlord@müller.de 2026-04-18",
    cite_b: "legal-memo-2026.pdf §4",
  },
  { kind: "blank" },
  { kind: "heading", text: "## Condition" },
  { kind: "fact", key: "last_inspection", value: "2026-02-14 · no issues", cite: "slack:#maint msg-8831" },
  { kind: "fact", key: "open_tickets", value: "1 · heating recal requested", cite: "zendesk:T-2210" },
];

export function ContextPreview() {
  const [shown, setShown] = useState(1);

  useEffect(() => {
    if (shown >= script.length) return;
    const line = script[shown];
    const delay = line.kind === "blank" ? 120 : line.kind === "heading" ? 500 : line.kind === "conflict" ? 900 : 420;
    const t = setTimeout(() => setShown((s) => s + 1), delay);
    return () => clearTimeout(t);
  }, [shown]);

  useEffect(() => {
    if (shown >= script.length) {
      const t = setTimeout(() => setShown(1), 3800);
      return () => clearTimeout(t);
    }
  }, [shown]);

  return (
    <div className="relative rounded-lg overflow-hidden" style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}>
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#3a2f26" }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#3a2f26" }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#3a2f26" }} />
        </div>
        <div className="flex-1 text-center font-mono text-[11px]" style={{ color: "var(--ink-dim)" }}>
          Context.md · Berliner Str. 42
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: "var(--ink-muted)" }}>
          <div className="w-1.5 h-1.5 rounded-full glow-pulse" style={{ background: "var(--amber)" }} />
          LIVE
        </div>
      </div>

      {/* Content */}
      <div className="md-preview font-mono text-[13px] leading-relaxed p-5 min-h-[460px]">
        {script.slice(0, shown).map((line, i) => {
          if (line.kind === "blank") return <div key={i} className="h-2 fact-appear" />;
          if (line.kind === "comment") {
            return (
              <div key={i} className="fact-appear" style={{ color: "var(--ink-dim)" }}>
                {line.text}
              </div>
            );
          }
          if (line.kind === "heading") {
            return (
              <h2 key={i} className="fact-appear">
                {line.text.replace(/^#+\s*/, "")}
              </h2>
            );
          }
          if (line.kind === "fact") {
            return (
              <p key={i} className="fact fact-appear">
                <span style={{ color: "var(--ink-muted)" }}>{line.key}:</span>{" "}
                <span className="fact-value">{line.value}</span>
                <span className="cite">^[{line.cite}]</span>
              </p>
            );
          }
          if (line.kind === "conflict") {
            return (
              <div key={i} className="fact-appear">
                <p className="conflict">
                  <span style={{ color: "var(--ink-muted)" }}>{line.key}:</span>{" "}
                  <span>⚠ conflict</span>
                </p>
                <p className="pl-4 conflict">
                  <span>→ {line.a}</span>
                  <span className="cite">^[{line.cite_a}]</span>
                </p>
                <p className="pl-4 conflict">
                  <span>→ {line.b}</span>
                  <span className="cite">^[{line.cite_b}]</span>
                </p>
                <p className="pl-4 text-[11px]" style={{ color: "var(--ink-dim)" }}>
                  posterior: P(€1,650) = 0.90 · P(€1,800) = 0.10 · via Dawid-Skene (1979)
                </p>
              </div>
            );
          }
          return null;
        })}
        {shown < script.length && (
          <span
            className="inline-block cursor-blink"
            style={{ width: 8, height: 14, background: "var(--amber)", transform: "translateY(2px)" }}
          />
        )}
      </div>
    </div>
  );
}
