// path: src/components/TimelineScrubber.tsx
"use client";

import { useMemo } from "react";
import type { Fact } from "@/lib/types";

type Props = {
  facts: Fact[];
  at: string; // ISO
  onChange?: (at: string) => void;
};

/**
 * Phase 1.5 skeleton. Renders the timeline dots + a handle at `at`.
 * onChange is a no-op in Phase 1.5 — the drag interaction wires in Phase 3
 * along with FR-12/13/14 (time scrubber + diff overlay + playback).
 */
export function TimelineScrubber({ facts, at, onChange }: Props) {
  const { min, max, ticks } = useMemo(() => {
    if (facts.length === 0) {
      const now = Date.now();
      return { min: now - 1000 * 60 * 60 * 24 * 30, max: now, ticks: [] };
    }
    const times = facts.map((f) => Date.parse(f.known_from)).filter(Number.isFinite);
    const mn = Math.min(...times);
    const mx = Math.max(Date.now(), ...times);
    // Bin to month buckets for tick display
    const bins = new Map<string, number>();
    for (const t of times) {
      const d = new Date(t);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      bins.set(key, (bins.get(key) ?? 0) + 1);
    }
    const ticks = [...bins.entries()].map(([key, count]) => {
      const [y, m] = key.split("-").map(Number);
      const t = new Date(y, m - 1, 15).getTime();
      return { t, count, key };
    });
    return { min: mn, max: mx, ticks };
  }, [facts]);

  const atMs = Date.parse(at);
  const pct =
    Number.isFinite(atMs) && max > min
      ? Math.max(0, Math.min(100, ((atMs - min) / (max - min)) * 100))
      : 100;

  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-mono uppercase tracking-wider"
            style={{ color: "var(--fg-dim)" }}
          >
            Timeline
          </span>
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{
              background: "var(--brand-wash)",
              color: "var(--brand-tint)",
            }}
            title="Interactive replay lands in Phase 3"
          >
            preview
          </span>
        </div>
        <span
          className="font-mono text-[11px]"
          style={{ color: "var(--fg-muted)" }}
        >
          now
        </span>
      </div>

      <div
        className="relative h-8"
        role="slider"
        aria-label="Context timeline (read-only preview)"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-disabled="true"
      >
        {/* Rail */}
        <div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px"
          style={{ background: "var(--border-muted)" }}
        />

        {/* Ticks */}
        {ticks.map(({ t, count, key }) => {
          const p = ((t - min) / (max - min)) * 100;
          const size = Math.min(10, 3 + Math.log2(count + 1) * 2);
          return (
            <span
              key={key}
              className="absolute top-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${Math.max(0, Math.min(100, p))}%`,
                width: size,
                height: size,
                background: "var(--fg-dim)",
                transform: `translate(-50%, -50%)`,
              }}
              title={`${key} · ${count} fact${count === 1 ? "" : "s"}`}
            />
          );
        })}

        {/* Handle */}
        <span
          className="absolute top-1/2 -translate-y-1/2"
          style={{
            left: `${pct}%`,
            transform: `translate(-50%, -50%)`,
          }}
        >
          <span
            className="block rounded-full"
            style={{
              width: 14,
              height: 14,
              background: "var(--brand)",
              boxShadow: "0 0 0 3px var(--bg-elevated), 0 0 0 4px var(--brand)",
            }}
          />
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
        <span>{formatDate(min)}</span>
        <span>{formatDate(max)}</span>
      </div>
    </div>
  );
}

function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
