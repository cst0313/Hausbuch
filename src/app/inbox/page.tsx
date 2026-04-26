// path: src/app/inbox/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { Nav } from "@/components/Nav";
import { NoteComposer } from "@/components/NoteComposer";
import { useLocale } from "@/components/LocaleProvider";

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
  reputation?: {
    score: number;
    band: "avoid" | "neutral" | "trusted";
    incidents_open: number;
    incidents_total: number;
    mahnung_count: number;
    last_incident_at: string | null;
    avoided?: { entity_id: string; name: string; score: number };
  };
};

type Recommendation = {
  id: string; severity: string;
  entity_id: string; entity_name: string; entity_type: string;
  category: string; title: string; title_en?: string; summary: string; summary_en?: string;
  facts: Array<{ predicate: string; value: string; source_title: string; known_from: string }>;
  email_chain: Array<{ source_id: string; title: string; from: string; date: string; excerpt: string }>;
  actions: RecommendedAction[];
  entity_reputation?: {
    score: number;
    band: "avoid" | "neutral" | "trusted";
    incidents_open: number;
    incidents_total: number;
    mahnung_count: number;
    related_units?: string[];
  };
  created_at: string;
};

type DraftResult = {
  subject: string; body: string; to: string; to_email: string;
  from: string; latency_ms: number; model: string;
};

// ── Severity config ─────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<string, { color: string; bg: string; key: string; icon: string }> = {
  critical: { color: "#991b1b", bg: "rgba(153,27,27,0.08)", key: "inbox.severity.critical", icon: "!!" },
  high:     { color: "#b45309", bg: "rgba(180,83,9,0.08)",  key: "inbox.severity.high",     icon: "!" },
  medium:   { color: "#0c4a6e", bg: "rgba(12,74,110,0.08)", key: "inbox.severity.medium",   icon: "·" },
  low:      { color: "#78716c", bg: "rgba(120,113,108,0.06)", key: "inbox.severity.low",    icon: "—" },
};

// ── Page ────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const { t, locale } = useLocale();
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
            {t("inbox.heading")}
          </h1>
          <p className="mt-2 text-[14px]" style={{ color: "var(--fg-muted)" }}>
            {t("inbox.heading.subtitle")}
          </p>
          {recs && (
            <p className="mt-1 text-[11px] font-mono" style={{ color: "var(--fg-dim)" }}>
              {recs.length} {t("inbox.count")} · {latency}ms · WEG Immanuelkirchstraße 26
            </p>
          )}
        </header>

        <div className="mb-8">
          <NoteComposer
            onIngested={() => {
              fetch("/api/recommendations")
                .then((r) => r.json())
                .then((d) => {
                  setRecs(d.recommendations);
                  setLatency(d.latency_ms);
                })
                .catch(() => {});
            }}
          />
        </div>

        {error && <p className="text-[13px] font-mono" style={{ color: "var(--danger)" }}>{t("inbox.error")} {error}</p>}
        {recs === null && !error && <p style={{ color: "var(--fg-muted)" }}>{t("inbox.loading")}</p>}

        <div className="space-y-10">
          {(["critical", "high", "medium", "low"] as const).map(sev => {
            const items = groups.get(sev) ?? [];
            if (items.length === 0) return null;
            const cfg = SEVERITY_CONFIG[sev];
            return (
              <section key={sev}>
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ background: cfg.bg, color: cfg.color }}>
                    {cfg.icon} {t(cfg.key)}
                  </span>
                  <span className="text-[11px] font-mono" style={{ color: "var(--fg-dim)" }}>{items.length}</span>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {items.slice(0, 10).map(rec => (
                    <RecommendationCard key={rec.id} rec={rec} severity={cfg} onDraft={openDraft} locale={locale} t={t} />
                  ))}
                </div>
                {items.length > 10 && (
                  <p className="mt-2 text-[11px] font-mono" style={{ color: "var(--fg-dim)" }}>
                    + {items.length - 10} {t("inbox.more")}
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
                {locale === "en" ? draftModal.action.label : draftModal.action.label_de}
              </h3>
              <button onClick={() => setDraftModal(null)} className="text-[20px]" style={{ color: "var(--fg-dim)" }}>×</button>
            </div>

            {draftModal.action.draft_context && (
              <div className="mb-4 text-[12px] font-mono space-y-1" style={{ color: "var(--fg-dim)" }}>
                <div>{t("inbox.draft.to")} {draftModal.action.draft_context.to} &lt;{draftModal.action.draft_context.to_email}&gt;</div>
                <div>{t("inbox.draft.subject")} {draftModal.action.draft_context.subject}</div>
              </div>
            )}

            {drafting && <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>{t("inbox.draft.drafting")}</p>}

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
                    {t("inbox.draft.copy")}
                  </button>
                </div>
              </div>
            )}

            {draftResult && "error" in draftResult && (
              <p className="text-[13px]" style={{ color: "var(--danger)" }}>
                {t("inbox.error")} {(draftResult as { error: string }).error}
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
  rec, severity, onDraft, locale, t,
}: {
  rec: Recommendation;
  severity: { color: string; bg: string };
  onDraft: (action: RecommendedAction, rec: Recommendation) => void;
  locale: "en" | "de";
  t: (key: string) => string;
}) {
  const entitySlug = encodeURIComponent(rec.entity_id);
  const entityTypeLabel = t(`inbox.entity.${rec.entity_type}`) || rec.entity_type;

  return (
    <article
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--border)", background: "var(--bg-elevated)" }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="text-[14px] font-semibold" style={{ color: "var(--fg)" }}>
            {locale === "en" ? (rec.title_en ?? rec.title) : rec.title}
          </h4>
          <div className="flex items-center gap-2 mt-1">
            <Link
              href={`/context/${entitySlug}`}
              className="text-[11px] font-mono hover:underline"
              style={{ color: severity.color }}
            >
              {rec.entity_name}
            </Link>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: severity.bg, color: severity.color }}>
              {entityTypeLabel}
            </span>
          </div>
        </div>
        <span className="text-[10px] font-mono" style={{ color: "var(--fg-dim)" }}>
          {shortDate(rec.created_at)}
        </span>
      </div>

      {/* Summary */}
      <p className="text-[12px] leading-relaxed mb-3" style={{ color: "var(--fg-muted)" }}>
        {(locale === "en" ? (rec.summary_en ?? rec.summary) : rec.summary).slice(0, 200)}
      </p>

      {/* Entity reputation flag (tenant or contractor) */}
      {rec.entity_reputation && <EntityReputationLine rep={rec.entity_reputation} entityType={rec.entity_type} />}

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
            {rec.email_chain.length} {t(rec.email_chain.length === 1 ? "inbox.email_thread.one" : "inbox.email_thread.many")}
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
          <div key={i} className="flex flex-col gap-1">
            <button
              onClick={() => onDraft(action, rec)}
              className="px-3 py-1.5 rounded text-[11px] font-medium transition-colors text-left"
              style={{
                background: action.type === "dispatch_contractor" || action.type === "draft_email"
                  ? "var(--brand)" : "var(--bg-hover)",
                color: action.type === "dispatch_contractor" || action.type === "draft_email"
                  ? "white" : "var(--fg-muted)",
              }}
            >
              {action.type === "dispatch_contractor" ? "📤 " : action.type === "draft_email" ? "✉ " : action.type === "escalate" ? "⚖ " : "→ "}
              {locale === "en" ? action.label : action.label_de}
            </button>
            {action.reputation && <ReputationBadge rep={action.reputation} />}
          </div>
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

function EntityReputationLine({
  rep,
  entityType,
}: {
  rep: NonNullable<Recommendation["entity_reputation"]>;
  entityType: string;
}) {
  const { locale } = useLocale();
  const bandColor =
    rep.band === "trusted" ? "#0d7835" : rep.band === "neutral" ? "#b45309" : "#991b1b";
  const bandBg =
    rep.band === "trusted"
      ? "rgba(13,120,53,0.10)"
      : rep.band === "neutral"
        ? "rgba(180,83,9,0.10)"
        : "rgba(153,27,27,0.10)";

  // Tenant cross-unit indicator
  const otherUnitCount = (rep.related_units?.length ?? 0) - 1;

  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-mono px-2 py-1 rounded"
      style={{ background: bandBg }}
    >
      <span style={{ color: bandColor }}>
        {entityType === "tenant" ? "tenant flag" : "rep"} · {rep.score.toFixed(2)} · {rep.band}
      </span>
      {rep.incidents_open > 0 && (
        <span style={{ color: "var(--fg-muted)" }}>
          {rep.incidents_open} open incident{rep.incidents_open === 1 ? "" : "s"}
        </span>
      )}
      {rep.mahnung_count > 0 && (
        <span style={{ color: "var(--fg-muted)" }}>· {rep.mahnung_count} {locale === "en" ? "dunning" : "Mahnung"}</span>
      )}
      {entityType === "tenant" && otherUnitCount > 0 && (
        <span style={{ color: "var(--fg-muted)" }}>
          · history at {otherUnitCount} other unit{otherUnitCount === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}

function ReputationBadge({
  rep,
}: {
  rep: NonNullable<RecommendedAction["reputation"]>;
}) {
  const { locale } = useLocale();
  const bandColor =
    rep.band === "trusted" ? "#0d7835" : rep.band === "neutral" ? "#b45309" : "#991b1b";
  const bandBg =
    rep.band === "trusted"
      ? "rgba(13,120,53,0.10)"
      : rep.band === "neutral"
        ? "rgba(180,83,9,0.10)"
        : "rgba(153,27,27,0.10)";
  const bandLabel =
    rep.band === "trusted" ? "trusted" : rep.band === "neutral" ? "neutral" : "avoid";

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
      <span
        className="px-1.5 py-0.5 rounded"
        style={{ background: bandBg, color: bandColor }}
        title={`${rep.incidents_open} open · ${rep.mahnung_count} dunning · score ${rep.score.toFixed(2)}`}
      >
        rep {rep.score.toFixed(2)} · {bandLabel}
      </span>
      {rep.incidents_open > 0 && (
        <span style={{ color: "var(--fg-dim)" }}>{rep.incidents_open} open</span>
      )}
      {rep.mahnung_count > 0 && (
        <span style={{ color: "var(--fg-dim)" }}>· {rep.mahnung_count} {locale === "en" ? "dunning" : "Mahnung"}</span>
      )}
      {rep.avoided && (
        <span style={{ color: "var(--fg-dim)" }}>
          · routed around {rep.avoided.name.slice(0, 24)} ({rep.avoided.score.toFixed(2)})
        </span>
      )}
    </div>
  );
}
