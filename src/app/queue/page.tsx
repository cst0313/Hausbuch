// path: src/app/queue/page.tsx
"use client";

import { useState } from "react";
import { Nav } from "@/components/Nav";
import { useLocale } from "@/components/LocaleProvider";

type Patch = {
  op: "add" | "supersede" | "reject";
  predicate: string;
  value: string;
  supersedes?: string;
  confidence: number;
};

type QueueItem = {
  id: string;
  title: string;
  source: string;
  received: string;
  excerpt: string;
  entity: string;
  entityLabel: string;
  patches: Patch[];
};

export default function QueuePage() {
  const { t } = useLocale();
  const [items, setItems] = useState<QueueItem[]>(seed);
  const [status, setStatus] = useState<Record<string, "approved" | "rejected" | undefined>>({});

  const act = (id: string, kind: "approved" | "rejected") => {
    setStatus((s) => ({ ...s, [id]: kind }));
    // Real wiring (POST /api/ingest or /api/queue/:id/approve) lands in Phase 2.
  };

  const remaining = items.filter((it) => !status[it.id]);

  return (
    <>
      <Nav />
      <main className="max-w-4xl mx-auto px-6 pt-16 pb-24 fade-up">
        <header className="mb-12 flex items-start justify-between gap-8">
          <div>
            <h1
              className="font-display"
              style={{
                fontSize: "clamp(2rem, 4.5vw, 3rem)",
                lineHeight: 1.05,
                letterSpacing: "-0.03em",
                fontWeight: 500,
              }}
            >
              {t("queue.title")}
            </h1>
            <p className="mt-3 text-[15px]" style={{ color: "var(--fg-muted)" }}>
              {t("queue.subtitle")}
            </p>
          </div>
          <div
            className="text-right text-[12px] font-mono shrink-0"
            style={{ color: "var(--fg-dim)" }}
          >
            <div>{remaining.length} pending</div>
            <div className="mt-0.5">{items.length - remaining.length} handled</div>
          </div>
        </header>

        {remaining.length === 0 ? (
          <p style={{ color: "var(--fg-muted)" }}>{t("common.empty")}</p>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <QueueCard
                key={item.id}
                item={item}
                status={status[item.id]}
                onAct={act}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function QueueCard({
  item,
  status,
  onAct,
}: {
  item: QueueItem;
  status: "approved" | "rejected" | undefined;
  onAct: (id: string, kind: "approved" | "rejected") => void;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);

  return (
    <article
      className="rounded-lg border overflow-hidden transition-opacity"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-elevated)",
        opacity: status ? 0.5 : 1,
      }}
    >
      {/* Header */}
      <div className="p-5 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="text-[11px] font-mono uppercase tracking-wider"
              style={{ color: "var(--fg-dim)" }}
            >
              {item.source}
            </span>
            <span
              className="text-[11px] font-mono"
              style={{ color: "var(--fg-dim)" }}
            >
              · {item.received}
            </span>
          </div>
          <h3
            className="text-[16px] font-semibold tracking-tight"
            style={{ color: "var(--fg)", letterSpacing: "-0.01em" }}
          >
            {item.title}
          </h3>
          <p
            className="mt-1 text-[12px] font-mono"
            style={{ color: "var(--fg-dim)" }}
          >
            → {item.entityLabel}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {status ? (
            <span
              className="text-[11px] font-mono uppercase tracking-wider px-2 py-1 rounded-full"
              style={{
                background:
                  status === "approved" ? "var(--brand-wash)" : "var(--bg-hover)",
                color:
                  status === "approved" ? "var(--brand-tint)" : "var(--fg-muted)",
              }}
            >
              {status}
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onAct(item.id, "approved")}
                className="h-9 px-4 rounded-md text-[13px] font-medium transition-all"
                style={{
                  background: "var(--brand)",
                  color: "#fff",
                }}
              >
                {t("queue.approve")}
              </button>
              <button
                type="button"
                onClick={() => onAct(item.id, "rejected")}
                className="h-9 px-3 rounded-md text-[13px] transition-colors"
                style={{
                  border: "1px solid var(--border-muted)",
                  color: "var(--fg)",
                }}
              >
                {t("queue.reject")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Excerpt */}
      <div
        className="px-5 pb-5 text-[13px] leading-relaxed"
        style={{ color: "var(--fg-muted)" }}
      >
        <blockquote
          className="italic pl-3 border-l"
          style={{
            borderColor: "var(--border-muted)",
            fontFamily: "var(--font-serif)",
          }}
        >
          {item.excerpt}
        </blockquote>
      </div>

      {/* Proposed patches */}
      <div
        className="border-t"
        style={{ borderColor: "var(--border)", background: "var(--bg)" }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full px-5 py-3 flex items-center justify-between text-[12px] font-mono"
          style={{ color: "var(--fg-muted)" }}
        >
          <span>
            {item.patches.length} proposed{" "}
            {item.patches.length === 1 ? "change" : "changes"}
          </span>
          <span style={{ color: "var(--fg-dim)" }}>{expanded ? "−" : "+"}</span>
        </button>
        {expanded && (
          <ul
            className="px-5 pb-5 space-y-2 text-[13px]"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            {item.patches.map((p, i) => (
              <li key={i} className="flex items-start gap-3 pt-3">
                <span
                  className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    background:
                      p.op === "add"
                        ? "var(--brand-wash)"
                        : p.op === "supersede"
                          ? "rgba(180, 83, 9, 0.18)"
                          : "rgba(153, 27, 27, 0.18)",
                    color:
                      p.op === "add"
                        ? "var(--brand-tint)"
                        : p.op === "supersede"
                          ? "var(--warning)"
                          : "var(--danger)",
                  }}
                >
                  {p.op}
                </span>
                <div className="flex-1 min-w-0">
                  <div>
                    <span
                      className="font-mono text-[11px] mr-2"
                      style={{ color: "var(--fg-dim)" }}
                    >
                      {p.predicate}
                    </span>
                    <span style={{ color: "var(--fg)" }}>{p.value}</span>
                  </div>
                  {p.supersedes && (
                    <div
                      className="mt-0.5 text-[11px] font-mono line-through"
                      style={{ color: "var(--fg-dim)" }}
                    >
                      was: {p.supersedes}
                    </div>
                  )}
                </div>
                <span
                  className="shrink-0 text-[11px] font-mono"
                  style={{ color: "var(--fg-dim)" }}
                >
                  {Math.round(p.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

// Placeholder queue — wires to /api/queue in Phase 2.
const seed: QueueItem[] = [
  {
    id: "q-001",
    title: "Ab 1. Juni 2026 wird die monatliche Miete auf 1.800 EUR erhöht.",
    source: "email · landlord@müller.de",
    received: "2026-04-18 09:12 UTC",
    entity: "property:berliner-str-42",
    entityLabel: "Berliner Str. 42 · Apt 3",
    excerpt:
      "Sehr geehrte Frau Schmidt, hiermit teile ich Ihnen mit, dass ab dem 1. Juni 2026 die monatliche Miete für Apt 3 auf 1.800 EUR erhöht wird.",
    patches: [
      {
        op: "add",
        predicate: "tenancy.rent.next",
        value: "€1,800 / mo effective 2026-06-01",
        confidence: 0.82,
      },
    ],
  },
  {
    id: "q-002",
    title: "Legal memo: Mietpreisbremse cap at €1,650",
    source: "upload · legal-memo-2026.pdf",
    received: "2026-04-20 14:22 UTC",
    entity: "property:berliner-str-42",
    entityLabel: "Berliner Str. 42 · Apt 3",
    excerpt:
      "Based on the Mietpreisbremse § 556d BGB, the maximum permissible rent for this property is €1,650 per month.",
    patches: [
      {
        op: "add",
        predicate: "tenancy.rent.next",
        value: "€1,650 / mo effective 2026-06-01 (statutory cap)",
        confidence: 0.94,
      },
    ],
  },
  {
    id: "q-003",
    title: "Leckage im Dachgeschoss — Wohnung 6",
    source: "zendesk · T-2210",
    received: "2026-04-22 08:04 UTC",
    entity: "property:berliner-str-42",
    entityLabel: "Berliner Str. 42 · Apt 6",
    excerpt:
      "Tenant reports water damage along the living-room ceiling. Maintenance contractor has been notified; awaiting site visit.",
    patches: [
      {
        op: "add",
        predicate: "condition.open_tickets",
        value: "1 open · Apt 6 · ceiling leak",
        confidence: 0.91,
      },
      {
        op: "supersede",
        predicate: "condition.last_inspection",
        value: "2026-04-22 (partial, Apt 6)",
        supersedes: "2026-02-14 (full building)",
        confidence: 0.45,
      },
    ],
  },
];
