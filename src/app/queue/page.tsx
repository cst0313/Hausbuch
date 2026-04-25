// path: src/app/queue/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { useLocale } from "@/components/LocaleProvider";

// Mirrors src/lib/db.ts ProposalKind / ProposalStatus / ProposalPayload.
type ProposalKind = "add" | "supersede" | "reject";
type ProposalStatus = "pending" | "approved" | "rejected" | "superseded";

type ProposalPayload = {
  predicate?: string;
  value?: string | number | boolean | null;
  unit?: string;
  valid_from?: string | null;
  valid_to?: string | null;
  span?: { start: number; end: number; quote: string };
  confidence?: number;
  supersedes?: string;
  rejects?: string;
};

type Proposal = {
  id: string;
  entity: string;
  source_id: string | null;
  kind: ProposalKind;
  payload: ProposalPayload;
  rationale: string | null;
  status: ProposalStatus;
  created_at: number;
  resolved_at: number | null;
  resolved_by: string | null;
};

type LocalStatus = "approved" | "rejected" | "pending-act";

export default function QueuePage() {
  const { t } = useLocale();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actStatus, setActStatus] = useState<Record<string, LocalStatus>>({});
  const [actError, setActError] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/queue?status=pending&limit=100", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { proposals: Proposal[] };
      setProposals(data.proposals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    setActStatus((s) => ({ ...s, [id]: "pending-act" }));
    setActError((e) => {
      const next = { ...e };
      delete next[id];
      return next;
    });
    try {
      const res = await fetch(`/api/queue/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolved_by: "demo-user" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setActStatus((s) => ({
        ...s,
        [id]: action === "approve" ? "approved" : "rejected",
      }));
    } catch (err) {
      setActError((e) => ({
        ...e,
        [id]: err instanceof Error ? err.message : String(err),
      }));
      setActStatus((s) => {
        const next = { ...s };
        delete next[id];
        return next;
      });
    }
  };

  const handled = proposals.filter((p) => {
    const s = actStatus[p.id];
    return s === "approved" || s === "rejected";
  }).length;
  const pending = proposals.length - handled;

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
            <div>{pending} pending</div>
            <div className="mt-0.5">{handled} handled</div>
          </div>
        </header>

        {loading ? (
          <p style={{ color: "var(--fg-muted)" }}>{t("common.loading")}</p>
        ) : error ? (
          <div
            className="rounded-md p-4 text-[13px]"
            style={{
              border: "1px solid var(--border-muted)",
              color: "var(--danger)",
              background: "var(--bg-elevated)",
            }}
          >
            {t("common.error")} — {error}
          </div>
        ) : proposals.length === 0 ? (
          <p style={{ color: "var(--fg-muted)" }}>{t("common.empty")}</p>
        ) : (
          <div className="space-y-4">
            {proposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                status={actStatus[p.id]}
                error={actError[p.id]}
                onAct={act}
              />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function ProposalCard({
  proposal,
  status,
  error,
  onAct,
}: {
  proposal: Proposal;
  status: LocalStatus | undefined;
  error: string | undefined;
  onAct: (id: string, action: "approve" | "reject") => void;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const finished = status === "approved" || status === "rejected";
  const acting = status === "pending-act";

  const headline = headlineFor(proposal);
  const sourceLabel = proposal.source_id ?? "manual proposal";
  const received = formatTimestamp(proposal.created_at);
  const excerpt = proposal.payload.span?.quote ?? proposal.rationale ?? "";

  return (
    <article
      className="rounded-lg border overflow-hidden transition-opacity"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-elevated)",
        opacity: finished ? 0.5 : 1,
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
              {sourceLabel}
            </span>
            <span
              className="text-[11px] font-mono"
              style={{ color: "var(--fg-dim)" }}
            >
              · {received}
            </span>
            {proposal.rationale && (
              <span
                className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  background: "var(--bg-hover)",
                  color: "var(--fg-muted)",
                }}
                title="why this is in the queue (not auto-accepted)"
              >
                {proposal.rationale}
              </span>
            )}
          </div>
          <h3
            className="text-[16px] font-semibold tracking-tight"
            style={{ color: "var(--fg)", letterSpacing: "-0.01em" }}
          >
            {headline}
          </h3>
          <p
            className="mt-1 text-[12px] font-mono"
            style={{ color: "var(--fg-dim)" }}
          >
            → {proposal.entity}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {finished ? (
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
                disabled={acting}
                onClick={() => onAct(proposal.id, "approve")}
                className="h-9 px-4 rounded-md text-[13px] font-medium transition-all disabled:opacity-60"
                style={{
                  background: "var(--brand)",
                  color: "#fff",
                }}
              >
                {acting ? t("common.loading") : t("queue.approve")}
              </button>
              <button
                type="button"
                disabled={acting}
                onClick={() => onAct(proposal.id, "reject")}
                className="h-9 px-3 rounded-md text-[13px] transition-colors disabled:opacity-60"
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
      {excerpt && (
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
            {excerpt}
          </blockquote>
        </div>
      )}

      {/* Error from last action attempt */}
      {error && (
        <div
          className="px-5 pb-3 text-[12px]"
          style={{ color: "var(--danger)" }}
        >
          {t("common.error")} — {error}
        </div>
      )}

      {/* Proposed patch */}
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
          <span>1 proposed change</span>
          <span style={{ color: "var(--fg-dim)" }}>{expanded ? "−" : "+"}</span>
        </button>
        {expanded && (
          <ul
            className="px-5 pb-5 space-y-2 text-[13px]"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <li className="flex items-start gap-3 pt-3">
              <span
                className="shrink-0 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  background:
                    proposal.kind === "add"
                      ? "var(--brand-wash)"
                      : proposal.kind === "supersede"
                        ? "rgba(180, 83, 9, 0.18)"
                        : "rgba(153, 27, 27, 0.18)",
                  color:
                    proposal.kind === "add"
                      ? "var(--brand-tint)"
                      : proposal.kind === "supersede"
                        ? "var(--warning)"
                        : "var(--danger)",
                }}
              >
                {proposal.kind}
              </span>
              <div className="flex-1 min-w-0">
                {proposal.kind === "reject" ? (
                  <div>
                    <span
                      className="font-mono text-[11px] mr-2"
                      style={{ color: "var(--fg-dim)" }}
                    >
                      reject source
                    </span>
                    <span style={{ color: "var(--fg)" }}>
                      {proposal.payload.rejects ?? "—"}
                    </span>
                  </div>
                ) : (
                  <>
                    <div>
                      <span
                        className="font-mono text-[11px] mr-2"
                        style={{ color: "var(--fg-dim)" }}
                      >
                        {proposal.payload.predicate ?? "—"}
                      </span>
                      <span style={{ color: "var(--fg)" }}>
                        {formatValue(proposal.payload.value)}
                        {proposal.payload.unit ? ` ${proposal.payload.unit}` : ""}
                      </span>
                    </div>
                    {proposal.kind === "supersede" && proposal.payload.supersedes && (
                      <div
                        className="mt-0.5 text-[11px] font-mono line-through"
                        style={{ color: "var(--fg-dim)" }}
                      >
                        was: fact {proposal.payload.supersedes}
                      </div>
                    )}
                  </>
                )}
              </div>
              {typeof proposal.payload.confidence === "number" && (
                <span
                  className="shrink-0 text-[11px] font-mono"
                  style={{ color: "var(--fg-dim) " }}
                  title="extractor confidence — labels below 0.7 are commonly low-confidence"
                >
                  {Math.round(proposal.payload.confidence * 100)}% conf.
                </span>
              )}
            </li>
          </ul>
        )}
      </div>
    </article>
  );
}

function headlineFor(p: Proposal): string {
  if (p.kind === "reject") {
    return `Reject source ${p.payload.rejects ?? "(unknown)"}`;
  }
  const pred = p.payload.predicate ?? "(unknown predicate)";
  const val = formatValue(p.payload.value);
  const verb = p.kind === "supersede" ? "Supersede" : "Add";
  return `${verb} ${pred} = ${val}`;
}

function formatValue(v: ProposalPayload["value"]): string {
  if (v === null || v === undefined) return "(empty)";
  return String(v);
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  try {
    return new Date(ms).toISOString().replace("T", " ").replace(/\..+$/, " UTC");
  } catch {
    return "—";
  }
}
