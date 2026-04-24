// path: src/components/FactExplainPopover.tsx
"use client";

import { ReactNode, useState } from "react";

type Props = {
  children: ReactNode;
  source: string;
  quote: string;
  confidence: number;
  knownFrom?: string;
  validFrom?: string;
  priorValues?: Array<{ value: string; date: string }>;
};

export function FactExplainPopover({
  children,
  source,
  quote,
  confidence,
  knownFrom,
  validFrom,
  priorValues,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="cursor-help" style={{ borderBottom: "1px dotted var(--line-bright)" }}>
        {children}
      </span>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-50 w-[380px] p-4 rounded-lg fact-appear"
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--line-bright)",
            boxShadow: "0 20px 40px rgba(0,0,0,0.6), 0 0 40px var(--amber-glow)",
          }}
        >
          <div className="flex items-start justify-between mb-2">
            <div
              className="text-[10px] font-mono uppercase tracking-wider"
              style={{ color: "var(--amber-bright)" }}
            >
              proof lens
            </div>
            <div
              className="text-[10px] font-mono"
              style={{ color: "var(--ink-dim)" }}
            >
              c = {confidence.toFixed(2)}
            </div>
          </div>

          <div
            className="text-[11px] font-mono mb-3 pb-3"
            style={{ color: "var(--ink-muted)", borderBottom: "1px solid var(--line)" }}
          >
            {source}
          </div>

          <div
            className="p-3 rounded text-[12px] font-mono leading-relaxed mb-3"
            style={{ background: "rgba(232, 178, 107, 0.06)", color: "var(--ink)", border: "1px solid var(--line)" }}
          >
            <div className="text-[9px] mb-1.5 uppercase tracking-wider" style={{ color: "var(--ink-dim)" }}>
              verbatim
            </div>
            <div style={{ color: "var(--amber-bright)" }}>&ldquo;{quote}&rdquo;</div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono mb-3">
            {validFrom && (
              <div>
                <div style={{ color: "var(--ink-dim)" }}>valid_from</div>
                <div style={{ color: "var(--ink)" }}>{validFrom}</div>
              </div>
            )}
            {knownFrom && (
              <div>
                <div style={{ color: "var(--ink-dim)" }}>known_from</div>
                <div style={{ color: "var(--ink)" }}>{knownFrom}</div>
              </div>
            )}
          </div>

          {priorValues && priorValues.length > 0 && (
            <div>
              <div
                className="text-[10px] uppercase tracking-wider mb-2"
                style={{ color: "var(--ink-dim)" }}
              >
                timeline
              </div>
              <div className="space-y-1">
                {priorValues.map((pv) => (
                  <div
                    key={pv.date}
                    className="flex items-center gap-2 text-[11px] font-mono"
                  >
                    <div className="w-1 h-1 rounded-full" style={{ background: "var(--ink-dim)" }} />
                    <span style={{ color: "var(--ink-dim)" }}>{pv.date}</span>
                    <span style={{ color: "var(--ink-muted)" }}>→</span>
                    <span style={{ color: "var(--ink)" }}>{pv.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div
            className="mt-3 pt-3 text-[10px]"
            style={{ borderTop: "1px solid var(--line)", color: "var(--ink-dim)" }}
          >
            Source monitoring · Johnson et al. 1993 · every fact traces.
          </div>
        </div>
      )}
    </span>
  );
}
