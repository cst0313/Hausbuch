// path: src/app/inbox/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Nav } from "@/components/Nav";

// ── Types from /api/recommendations ─────────────────────────────────────────

type DraftContext = {
  from: string; to: string; to_email: string; subject: string;
  incident_summary: string; entity_context: string;
  language: "de" | "en"; tone: "formal" | "urgent";
};

type RecommendedAction = {
  type: string; label: string; label_de: string;
  recipient?: { entity_id: string; name: string; email?: string; role: string };
  draft_context?: DraftContext;
};

type Recommendation = {
  id: string; severity: string;
  entity_id: string; entity_name: string; entity_type: string;
  category: string; title: string; summary: string;
  facts: Array<{ predicate: string; value: string; source_title: string; known_from: string }>;
  email_chain: Array<{ source_id: string; title: string; from: string; date: string; excerpt: string }>;
  actions: RecommendedAction[];
  created_at: string;
};

type DraftResult = {
  subject: string; body: string; to: string; to_email: string;
  from: string; latency_ms: number; model: string;
};

// ── Severity config ─────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  critical: { color: "#991b1b", bg: "rgba(153,27,27,0.08)", label: "Kritisch", icon: "!!" },
  high:     { color: "#b45309", bg: "rgba(180,83,9,0.08)",  label: "Hoch",     icon: "!" },
  medium:   { color: "#0c4a6e", bg: "rgba(12,74,110,0.08)", label: "Mittel",   icon: "·" },
  low:      { color: "#78716c", bg: "rgba(120,113,108,0.06)", label: "Niedrig", icon: "—" },
};

// ── Page ────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [latency, setLatency] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [draftModal, setDraftModal] = useState<{ action: RecommendedAction; rec: Recommendation } | null>(null);
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    fetch("/api/recommendations")
      .then(r => r.json())
      .then(d => { setRecs(d.recommendations); setLatency(d.latency_ms); })
      .catch(e => setError(String(e)));
  }, []);

  const openDraft = useCallback(async (action: RecommendedAction, rec: Recommendation) => {
    setDraftModal({ action, rec });
    setDraftResult(null);
    if (!action.draft_context) return;
    setDrafting(true);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action.draft_context),
      });
      const result = await res.json();
      setDraftResult(result);
    } catch {
      setDraftResult(null);
    } finally {
      setDrafting(false);
    }
  }, []);

  // Group by severity
  const groups = new Map<string, Recommendation[]>();
  for (const sev of ["critical", "high", "medium", "low"]) groups.set(sev, []);
  for (const r of (recs ?? [])) {
    const g = groups.get(r.severity) ?? [];
    g.push(r);
    groups.set(r.severity, g);
  }

  return (
    <>
      <Nav />
      <main className="max-w-6xl mx-auto px-6 pt-16 pb-24 fade-up">
        <header className="mb-10">
          <h1
            className="font-display"
            style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)", lineHeight: 1.1, letterSpacing: "-0.03em", fontWeight: 500 }}
          >
            Vorgangsliste
          </h1>
          <p className="mt-2 text-[14px]" style={{ color: "var(--fg-muted)" }}>
            Offene Vorgänge, priorisiert nach Dringlichkeit. Empfohlene nächste Schritte pro Vorgang.
          </p>
          {recs && (
            <p className="mt-1 text-[11px] font-mono" style={{ color: "var(--fg-dim)" }}>
              {recs.length} Vorgänge · {latency}ms · WEG Immanuelkirchstraße 26
            </p>
          )}
        </header>

        {error && <p className="text-[13px] font-mono" style={{ color: "var(--danger)" }}>Fehler: {error}</p>}
        {recs === null && !error && <p style={{ color: "var(--fg-muted)" }}>Lade Vorgänge...</p>}

        <div className="space-y-10">
          {(["critical", "high", "medium", "low"] as const).map(sev => {
            const items = groups.get(sev) ?? [];
            if (items.length === 0) return null;
            const cfg = SEVERITY_CONFIG[sev];
            return (
              <section key={sev}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ background: cfg.bg, color: cfg.color }}>
                    {cfg.icon} {cfg.label}
                  </span>
                  <span className="text-[11px] font-mono" style={{ color: "var(--fg-dim)" }}>{items.length}</span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {items.slice(0, 10).map(rec => (
                    <RecommendationCard key={rec.id} rec={rec} severity={cfg} onDraft={openDraft} />
                  ))}
                </div>
                {items.length > 10 && (
                  <p className="mt-2 text-[11px] font-mono" style={{ color: "var(--fg-dim)" }}>
                    + {items.length - 10} weitere
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </main>

      {/* Draft modal */}
      {draftModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setDraftModal(null)}
        >
          <div
            className="rounded-lg border p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
            style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[16px] font-semibold" style={{ color: "var(--fg)" }}>
                {draftModal.action.label_de}
              </h3>
              <button onClick={() => setDraftModal(null)} className="text-[20px]" style={{ color: "var(--fg-dim)" }}>×</button>
            </div>

            {draftModal.action.draft_context && (
              <div className="mb-4 text-[12px] font-mono space-y-1" style={{ color: "var(--fg-dim)" }}>
                <div>An: {draftModal.action.draft_context.to} &lt;{draftModal.action.draft_context.to_email}&gt;</div>
                <div>Betreff: {draftModal.action.draft_context.subject}</div>
              </div>
            )}

            {drafting && <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>Gemini erstellt Entwurf...</p>}

            {draftResult?.body && (
              <div className="rounded border p-4 mt-2" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
                <pre className="text-[13px] whitespace-pre-wrap leading-relaxed" style={{ color: "var(--fg)", fontFamily: "inherit" }}>
                  {draftResult.body}
                </pre>
                <div className="mt-3 flex items-center gap-3 text-[11px] font-mono" style={{ color: "var(--fg-dim)" }}>
                  <span>{draftResult.model}</span>
                  <span>{draftResult.latency_ms}ms</span>
                  <button
                    className="px-3 py-1 rounded text-[11px]"
                    style={{ background: "var(--brand)", color: "white" }}
                    onClick={() => { navigator.clipboard.writeText(draftResult.body); }}
                  >
                    Kopieren
                  </button>
                </div>
              </div>
            )}

            {draftResult && "error" in draftResult && (
              <p className="text-[13px]" style={{ color: "var(--danger)" }}>
                Fehler: {(draftResult as { error: string }).error}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── Recommendation card ─────────────────────────────────────────────────────

function RecommendationCard({
  rec, severity, onDraft,
}: {
  rec: Recommendation;
  severity: { color: string; bg: string };
  onDraft: (action: RecommendedAction, rec: Recommendation) => void;
}) {
  const entitySlug = encodeURIComponent(rec.entity_id);
  const typeLabels: Record<string, string> = {
    tenant: "Mieter", owner: "Eigentümer", contractor: "Dienstleister",
    unit: "Einheit", building: "Gebäude", weg: "WEG",
  };

  return (
    <article
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="text-[14px] font-semibold" style={{ color: "var(--fg)" }}>{rec.title}</h4>
          <div className="flex items-center gap-2 mt-1">
            <Link
              href={`/context/${entitySlug}`}
              className="text-[11px] font-mono hover:underline"
              style={{ color: severity.color }}
            >
              {rec.entity_name}
            </Link>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: severity.bg, color: severity.color }}>
              {typeLabels[rec.entity_type] ?? rec.entity_type}
            </span>
          </div>
        </div>
        <span className="text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
          {shortDate(rec.created_at)}
        </span>
      </div>

      {/* Summary */}
      <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--fg-muted)" }}>
        {rec.summary.slice(0, 200)}
      </p>

      {/* Evidence facts */}
      {rec.facts.length > 0 && (
        <div className="mb-3 space-y-1">
          {rec.facts.slice(0, 3).map((f, i) => (
            <div key={i} className="flex items-baseline gap-2 text-[11px]">
              <span className="font-mono shrink-0" style={{ color: "var(--fg-dim)" }}>{f.predicate}</span>
              <span style={{ color: "var(--fg-muted)" }}>{f.value}</span>
              <span className="ml-auto font-mono" style={{ color: "var(--fg-dim)" }}>^[{f.source_title.slice(0, 30)}]</span>
            </div>
          ))}
        </div>
      )}

      {/* Email chain preview */}
      {rec.email_chain.length > 0 && (
        <details className="mb-3">
          <summary className="text-[11px] font-mono cursor-pointer" style={{ color: "var(--fg-dim)" }}>
            {rec.email_chain.length} E-Mail{rec.email_chain.length > 1 ? "s" : ""} im Verlauf
          </summary>
          <div className="mt-2 space-y-1 pl-3 border-l" style={{ borderColor: "var(--border)" }}>
            {rec.email_chain.slice(0, 4).map((e, i) => (
              <div key={i} className="text-[11px]">
                <span className="font-mono" style={{ color: "var(--fg-dim)" }}>{shortDate(e.date)}</span>
                {" "}
                <span style={{ color: "var(--fg-muted)" }}>{e.title.slice(0, 60)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
        {rec.actions.map((action, i) => (
          <button
            key={i}
            onClick={() => onDraft(action, rec)}
            className="px-3 py-1.5 rounded text-[11px] font-medium transition-colors"
            style={{
              background: action.type === "dispatch_contractor" || action.type === "draft_email"
                ? "var(--brand)" : "var(--bg-hover)",
              color: action.type === "dispatch_contractor" || action.type === "draft_email"
                ? "white" : "var(--fg-muted)",
            }}
          >
            {action.type === "dispatch_contractor" ? "📤 " : action.type === "draft_email" ? "✉ " : action.type === "escalate" ? "⚖ " : "→ "}
            {action.label_de}
          </button>
        ))}
        <Link
          href={`/context/${entitySlug}`}
          className="px-3 py-1.5 rounded text-[11px] font-mono transition-colors"
          style={{ background: "var(--bg-hover)", color: "var(--fg-dim)" }}
        >
          Context.md →
        </Link>
      </div>
    </article>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}
