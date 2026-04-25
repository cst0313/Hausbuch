// path: src/components/ActivityLog.tsx
"use client";

import { useEffect, useRef, useState } from "react";

type EventKind =
  | "hello"
  | "source.ingested"
  | "extractor.completed"
  | "fact.inserted"
  | "conflict.detected"
  | "render.completed";

type LumenEventWire = {
  kind: EventKind;
  at: string;
  [k: string]: unknown;
};

const kindColors: Partial<Record<EventKind, string>> = {
  "source.ingested": "#e8b26b",
  "extractor.completed": "#a7c4e8",
  "fact.inserted": "#8fd280",
  "conflict.detected": "#d68572",
  "render.completed": "#f4ead5",
};

const kindLabels: Partial<Record<EventKind, string>> = {
  "source.ingested": "source.ingest",
  "extractor.completed": "extractor.ok",
  "fact.inserted": "fact.insert",
  "conflict.detected": "conflict!",
  "render.completed": "render.ok",
};

export function ActivityLog() {
  const [events, setEvents] = useState<LumenEventWire[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    sourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as LumenEventWire;
        setEvents((prev) => [...prev.slice(-29), parsed]);
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      // keep quiet; dev server restart will trigger reconnect
    };
    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events]);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full glow-pulse"
            style={{ background: "var(--amber)" }}
          />
          <span className="font-mono text-[11px]" style={{ color: "var(--ink-muted)" }}>
            hausbuch.system.activity · /api/stream
          </span>
        </div>
        <span className="font-mono text-[10px]" style={{ color: "var(--ink-dim)" }}>
          live · sse · {events.length} events
        </span>
      </div>
      <div
        ref={scrollRef}
        className="p-4 font-mono text-[11px] leading-relaxed h-[200px] overflow-y-auto"
      >
        {events.length === 0 ? (
          <div style={{ color: "var(--ink-dim)" }}>
            <span
              className="inline-block cursor-blink mr-1"
              style={{
                width: 6,
                height: 10,
                background: "var(--amber)",
                transform: "translateY(1px)",
              }}
            />
            listening on /api/stream…
          </div>
        ) : (
          events.map((e, i) => (
            <div key={i} className="flex gap-3 fact-appear">
              <span style={{ color: "var(--ink-dim)" }}>
                {formatTime(e.at)}
              </span>
              <span
                style={{
                  color: kindColors[e.kind] ?? "var(--ink-muted)",
                  width: "100px",
                  flexShrink: 0,
                }}
              >
                {kindLabels[e.kind] ?? e.kind}
              </span>
              <span style={{ color: "var(--ink)" }}>{formatBody(e)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
  } catch {
    return iso;
  }
}

function formatBody(e: LumenEventWire): string {
  if (e.kind === "source.ingested") return `${e.title} · id=${e.source_id}`;
  if (e.kind === "extractor.completed")
    return `source=${e.source_id} · ${e.fact_count} facts`;
  if (e.kind === "fact.inserted") return `${e.predicate} = ${e.value}`;
  if (e.kind === "conflict.detected") {
    const poss = Array.isArray(e.posterior)
      ? (e.posterior as Array<{ value: string; probability: number }>)
          .map((p) => `P(${p.value})=${p.probability.toFixed(2)}`)
          .join(" · ")
      : "";
    return `${e.predicate} — ${poss}`;
  }
  if (e.kind === "render.completed")
    return `${e.entity} · ${e.fact_count} facts · ${e.latency_ms}ms`;
  if (e.kind === "hello") return "stream connected";
  return JSON.stringify(e);
}
