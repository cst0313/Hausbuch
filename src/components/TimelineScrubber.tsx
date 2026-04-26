// path: src/components/TimelineScrubber.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Fact } from "@/lib/types";

type Props = {
  facts: Fact[];
  /** Current valid-time (ISO) the page is rendering AT. */
  at: string;
  /** Fired when the user drags / steps the slider. ISO string. */
  onChange?: (at: string) => void;
  /** Optional preset jumps. Fired when the user clicks a tick. */
  onJumpToTick?: (at: string) => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bitemporal time-travel slider.
 *
 * Slides through valid-time. Each tick is a month bucket of facts the system
 * has on file; the size of the dot scales with how many facts landed in that
 * month so a judge can see "lots happened in March 2025" at a glance.
 *
 * The interaction:
 *   • Drag the handle (or click a tick) → onChange fires with an ISO date.
 *   • The parent re-fetches /api/context/<id>?at_valid=<iso> and re-renders.
 *   • Keyboard: ←/→ steps by one day, Home/End jumps to bounds, PgUp/PgDn
 *     by ±30 days. (Native <input type=range> handles this for free.)
 *
 * Throttled at 120 ms so a continuous drag doesn't fire 60 fetches/second.
 */
export function TimelineScrubber({ facts, at, onChange, onJumpToTick }: Props) {
  const { min, max, ticks } = useMemo(() => {
    if (facts.length === 0) {
      const now = Date.now();
      return {
        min: now - DAY_MS * 365,
        max: now,
        ticks: [] as Array<{ t: number; count: number; key: string }>,
      };
    }
    // Prefer valid_from (when in the world the fact was true) over
    // known_from (when we wrote it). For seeded data the latter is all
    // "today" — using it collapses every entity to a single-point
    // timeline (slider stuck, divide-by-zero). valid_from spreads the
    // facts across actual real-world time.
    const times = facts
      .map((f) => Date.parse(f.valid_from ?? f.known_from))
      .filter(Number.isFinite);
    let mn = Math.min(...times);
    let mx = Math.max(Date.now(), ...times);
    // Degenerate range — entity has facts on a single day (e.g. a unit
    // with only stammdaten). Pad the range so the slider has somewhere
    // to scrub: 90 days behind the only date, 7 days ahead. The user
    // sees "no earlier history" instead of a frozen handle.
    const MIN_RANGE_MS = 30 * DAY_MS;
    if (mx - mn < MIN_RANGE_MS) {
      mn = Math.min(mn, mn - 90 * DAY_MS);
      mx = Math.max(mx, mx + 7 * DAY_MS);
    }
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
  const safeAtMs = Number.isFinite(atMs) ? atMs : max;
  const pct = max > min ? Math.max(0, Math.min(100, ((safeAtMs - min) / (max - min)) * 100)) : 100;

  // Local mirror for smooth dragging — we commit (fire onChange) on a small
  // throttle so the parent doesn't refetch on every pixel.
  const [draftMs, setDraftMs] = useState<number>(safeAtMs);
  useEffect(() => {
    setDraftMs(safeAtMs);
  }, [safeAtMs]);

  const lastFireRef = useRef<number>(0);
  const pendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fireChange = (ms: number) => {
    if (!onChange) return;
    const iso = new Date(ms).toISOString();
    const now = Date.now();
    const elapsed = now - lastFireRef.current;
    if (elapsed > 120) {
      lastFireRef.current = now;
      onChange(iso);
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = null;
      }
      return;
    }
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
    pendingTimeoutRef.current = setTimeout(() => {
      lastFireRef.current = Date.now();
      onChange(iso);
    }, 120 - elapsed);
  };

  const draftPct = max > min ? ((draftMs - min) / (max - min)) * 100 : 100;
  const draftDate = new Date(draftMs);
  const isAtNow = Math.abs(draftMs - Date.now()) < DAY_MS;

  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
    >
      <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-mono uppercase tracking-wider"
            style={{ color: "var(--fg-dim)" }}
          >
            Time-travel
          </span>
          <span
            className="font-mono text-[12px] px-2 py-0.5 rounded"
            style={{
              background: "var(--brand-wash)",
              color: "var(--brand)",
              fontFeatureSettings: '"tnum"',
            }}
            title="Drag the slider · ← → step by day · Home/End jump to bounds"
          >
            {formatLong(draftDate)}
          </span>
          {!isAtNow && (
            <button
              onClick={() => {
                const now = Date.now();
                setDraftMs(now);
                if (onChange) onChange(new Date(now).toISOString());
              }}
              className="font-mono text-[10px] px-2 py-0.5 rounded transition-colors hover:opacity-80"
              style={{
                color: "var(--fg-muted)",
                background: "var(--bg-hover)",
                border: "1px solid var(--border-muted)",
                cursor: "pointer",
              }}
              title="Jump back to today"
            >
              now ↺
            </button>
          )}
        </div>
        <span
          className="font-mono text-[10px]"
          style={{ color: "var(--fg-dim)" }}
        >
          {ticks.reduce((s, t) => s + t.count, 0)} facts on the timeline
        </span>
      </div>

      <div className="relative h-8">
        {/* Rail */}
        <div
          className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px pointer-events-none"
          style={{ background: "var(--border-muted)" }}
        />

        {/* Filled portion left of the handle, brand-tinted */}
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-px pointer-events-none"
          style={{
            width: `${draftPct}%`,
            background: "var(--brand)",
            opacity: 0.55,
          }}
        />

        {/* Ticks — clickable so judges can jump to "March 2025" with one tap */}
        {ticks.map(({ t, count, key }) => {
          const p = ((t - min) / (max - min)) * 100;
          const size = Math.min(12, 3 + Math.log2(count + 1) * 2);
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                setDraftMs(t);
                if (onJumpToTick) onJumpToTick(new Date(t).toISOString());
                else if (onChange) onChange(new Date(t).toISOString());
              }}
              title={`${key} · ${count} fact${count === 1 ? "" : "s"}`}
              className="absolute top-1/2 rounded-full transition-transform hover:scale-150"
              style={{
                left: `${Math.max(0, Math.min(100, p))}%`,
                width: size,
                height: size,
                background: t <= draftMs ? "var(--brand)" : "var(--fg-dim)",
                opacity: t <= draftMs ? 0.85 : 0.5,
                transform: `translate(-50%, -50%)`,
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            />
          );
        })}

        {/* Native range input — gives us drag, keyboard, and accessibility for free */}
        <input
          type="range"
          min={min}
          max={max}
          step={DAY_MS}
          value={draftMs}
          onChange={(e) => {
            const ms = Number(e.target.value);
            setDraftMs(ms);
            fireChange(ms);
          }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="Time-travel slider"
          style={{ WebkitAppearance: "none" } as React.CSSProperties}
        />

        {/* Visual handle */}
        <span
          className="absolute top-1/2 pointer-events-none"
          style={{
            left: `${draftPct}%`,
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

      <div
        className="mt-2 flex items-center justify-between text-[10px] font-mono"
        style={{ color: "var(--fg-dim)" }}
      >
        <span>{formatDate(min)}</span>
        <span>drag · click ticks · ←/→ for day · Home/End for bounds</span>
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

function formatLong(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
