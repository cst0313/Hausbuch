// path: src/components/LiveCostTicker.tsx
"use client";

import { useEffect, useState } from "react";

type LumenEventWire = {
  kind: string;
  at: string;
  [k: string]: unknown;
};

/**
 * Live ticker in the nav. Subscribes to /api/stream and accumulates real
 * pipeline stats — facts ingested this session, conflicts detected, events.
 * No random drift. If nothing has happened yet, we show a neutral state.
 */
export function LiveCostTicker() {
  const [factsIngested, setFactsIngested] = useState(0);
  const [conflicts, setConflicts] = useState(0);
  const [renders, setRenders] = useState(0);
  const [events, setEvents] = useState(0);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onmessage = (msg) => {
      try {
        const e = JSON.parse(msg.data) as LumenEventWire;
        setEvents((n) => n + 1);
        if (e.kind === "fact.inserted") setFactsIngested((n) => n + 1);
        if (e.kind === "conflict.detected") setConflicts((n) => n + 1);
        if (e.kind === "render.completed") setRenders((n) => n + 1);
      } catch {
        // skip malformed
      }
    };
    es.onerror = () => {
      // silent; reconnect handled by browser
    };
    return () => es.close();
  }, []);

  return (
    <div
      className="hidden md:flex items-center gap-0 rounded-full overflow-hidden text-[11px] font-mono"
      style={{ border: "1px solid var(--line)" }}
      title="Live from /api/stream — this session's pipeline activity, not a simulation."
    >
      <div
        className="px-2.5 py-1 flex items-center gap-1.5"
        style={{ background: "rgba(232, 178, 107, 0.08)", borderRight: "1px solid var(--line)" }}
      >
        <span style={{ color: "var(--ink-dim)" }}>facts</span>
        <span style={{ color: "var(--amber-bright)" }}>
          {factsIngested.toLocaleString()}
        </span>
      </div>
      <div
        className="px-2.5 py-1 flex items-center gap-1.5"
        style={{ borderRight: "1px solid var(--line)" }}
      >
        <span style={{ color: "var(--ink-dim)" }}>conflicts</span>
        <span style={{ color: conflicts > 0 ? "#d68572" : "var(--ink)" }}>{conflicts}</span>
      </div>
      <div
        className="px-2.5 py-1 flex items-center gap-1.5"
        style={{ borderRight: "1px solid var(--line)" }}
      >
        <span style={{ color: "var(--ink-dim)" }}>renders</span>
        <span style={{ color: "var(--ink)" }}>{renders}</span>
      </div>
      <div className="px-2.5 py-1 flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 rounded-full glow-pulse"
          style={{ background: events > 0 ? "var(--amber)" : "#3a2f26" }}
        />
        <span style={{ color: "var(--ink-dim)" }}>sse</span>
      </div>
    </div>
  );
}
