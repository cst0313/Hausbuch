// path: src/components/StreamPanel.tsx
"use client";

import { useEffect, useState } from "react";

// Shape narrow enough for the panel; the dashboard hands it the live recommendation.
export type StreamRec = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  entity_id: string;
  entity_name: string;
  entity_type: string;
  category: string;
  title: string;
  title_en?: string;
  summary: string;
  summary_en?: string;
  facts?: Array<{
    predicate: string;
    value: string;
    source_title: string;
    known_from: string;
    valid_from?: string | null;
    valid_to?: string | null;
  }>;
  email_chain?: Array<{
    source_id: string;
    title: string;
    from?: string;
    date: string;
    excerpt?: string;
  }>;
  actions: Array<{
    type: string;
    label: string;
    label_de: string;
    recipient?: { entity_id: string; name: string; email?: string; role: string };
    draft_context?: {
      to: string;
      to_email: string;
      subject: string;
      incident_summary: string;
      language: "en" | "de";
      tone: string;
    };
  }>;
  entity_reputation?: {
    score: number;
    band: "trusted" | "neutral" | "avoid";
    incidents_open: number;
    mahnung_count: number;
    /** Unit / building IDs derived from the entity's history — lets the
     *  header surface "lives in WE 32" chips that link to the property. */
    related_units?: string[];
  };
};

type AuditStep = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  partner: string | null;
  latency_ms: number | null;
};

type DraftResult = {
  subject?: string;
  body?: string;
  to?: string;
  to_email?: string;
  model?: string;
  latency_ms?: number;
  error?: string;
};

const SEV_COLOR: Record<StreamRec["severity"], string> = {
  critical: "var(--severity-critical)",
  high: "var(--severity-high)",
  medium: "var(--severity-medium)",
  low: "var(--severity-low)",
};

export function StreamPanel({
  rec,
  open,
  locale,
  onClose,
  onResolve,
  resolved,
  sent,
  onSend,
  onDispatch,
  onOpenEntity,
}: {
  rec: StreamRec | null;
  open: boolean;
  locale: "en" | "de";
  onClose: () => void;
  onResolve: () => void;
  resolved: boolean;
  sent: boolean;
  onSend: () => void;
  onDispatch?: () => void;
  /** When provided, the entity name in the header becomes a clickable link
   *  that opens the entity's profile panel. */
  onOpenEntity?: (id: string) => void;
}) {
  const [auditSteps, setAuditSteps] = useState<AuditStep[]>([]);
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  // Load audit stream + draft when a rec opens
  useEffect(() => {
    if (!open || !rec) return;
    let cancelled = false;
    setAuditSteps([]);
    setDraft(null);

    fetch(`/api/audit?entity=${encodeURIComponent(rec.entity_id)}&limit=40`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setAuditSteps(d.actions ?? []);
      })
      .catch(() => {});

    // The suggested email surfaced in the panel is the TENANT-facing reply,
    // not the contractor dispatch. Both actions can carry a draft_context,
    // so we prefer type === "draft_email" first; fall back to any draft only
    // if no draft_email exists. Otherwise a Mietminderung rec showed the
    // "Sehr geehrter Herr Jessel" dispatch text where the manager expected
    // "we'll deal with it" to the tenant.
    const draftAction =
      rec.actions.find((a) => a.type === "draft_email" && a.draft_context) ??
      rec.actions.find((a) => a.draft_context);
    if (draftAction?.draft_context) {
      // Cache the draft in sessionStorage keyed by the full draft context.
      // Re-opening the same incident in the same session never re-bills Gemini.
      const cacheKey = `hausbuch:draft:${hashKey(JSON.stringify(draftAction.draft_context))}`;
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          setDraft(JSON.parse(cached) as DraftResult);
          return () => {
            cancelled = true;
          };
        }
      } catch {
        /* sessionStorage unavailable — fall through to fetch */
      }

      setDrafting(true);
      fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftAction.draft_context),
      })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          setDraft(d);
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify(d));
          } catch {
            /* quota / disabled — silently skip */
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setDrafting(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [open, rec]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!rec) {
    return null;
  }

  const title = locale === "en" ? rec.title_en ?? rec.title : rec.title;
  const summary = locale === "en" ? rec.summary_en ?? rec.summary : rec.summary;
  const sevColor = SEV_COLOR[rec.severity];

  // Step progression — five canonical steps for any thread.
  // 1 Received → 2 Reviewed → 3 Drafted → 4 Sent / Dispatched → 5 Resolved
  const STEP_LABELS_EN = [
    "Received",
    "Reviewed",
    "Draft prepared",
    "Sent / dispatched",
    "Resolved",
  ];
  const STEP_LABELS_DE = [
    "Eingegangen",
    "Geprüft",
    "Entwurf bereit",
    "Gesendet / beauftragt",
    "Erledigt",
  ];
  const totalSteps = 5;
  // Mirror the dashboard RecRow step calc — if the rec engine has surfaced a
  // follow_up action, the original outbound is already on file (awaiting-reply
  // state) and the case is at step 4, not step 3. Without this the row showed
  // 4/5 but clicking in showed 3/5 for the same rec.
  const hasFollowUp = rec.actions.some((a) => a.type === "follow_up");
  const stepReached = resolved
    ? 5
    : sent || hasFollowUp
      ? 4
      : draft && !drafting
        ? 3
        : 2;
  const currentStep = stepReached;
  const labels = locale === "en" ? STEP_LABELS_EN : STEP_LABELS_DE;
  const stepLabel = labels[stepReached - 1];

  const handleSend = async () => {
    if (!draft || sending || sent) return;
    setSending(true);
    setTimeout(() => {
      setSending(false);
      onSend();
    }, 600);
  };

  // Build a unified timeline: emails (from rec.email_chain) + system actions (audit)
  type TimelineItem = {
    ts: string;
    actor: string;
    actorName: string;
    title: string;
    excerpt?: string;
    kind: "inbound" | "outbound" | "system" | "user";
    source_id?: string;
  };
  const items: TimelineItem[] = [];
  for (const e of rec.email_chain ?? []) {
    const isIn = !!e.from && !e.from.includes("@huber-partner") && !e.from.includes("@hausbuch");
    items.push({
      ts: e.date,
      actor: isIn ? "tenant" : "manager",
      actorName: e.from ?? (isIn ? "Tenant" : "Manager"),
      title: e.title,
      excerpt: e.excerpt,
      kind: isIn ? "inbound" : "outbound",
      source_id: e.source_id,
    });
  }
  for (const a of auditSteps) {
    items.push({
      ts: a.ts,
      actor: a.actor,
      actorName: a.actor,
      title: a.action,
      excerpt: a.partner ? `via ${a.partner}${a.latency_ms ? ` · ${a.latency_ms}ms` : ""}` : undefined,
      kind: a.actor === "user" ? "user" : "system",
    });
  }
  // Newest first
  items.sort((a, b) => b.ts.localeCompare(a.ts));

  return (
    <>
      {/* Full-page overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--bg)",
          opacity: open ? 1 : 0,
          transform: open ? "translateY(0)" : "translateY(8px)",
          transition: "opacity 200ms ease, transform 200ms ease",
          pointerEvents: open ? "auto" : "none",
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        aria-hidden={!open}
      >
        {/* Header */}
        <div
          style={{
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            background: "var(--bg)",
          }}
        >
        <div style={{ padding: "20px 32px 18px", maxWidth: 1480, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: sevColor,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              <span style={{ fontWeight: 600 }}>{rec.severity}</span>
              <span style={{ color: "var(--fg-dim)" }}> · {rec.category} · {rec.entity_id}</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <a
                href={`/api/report/incident/${encodeURIComponent(rec.id)}?download=1`}
                target="_blank"
                rel="noopener noreferrer"
                title="Generate Markdown report for this thread"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--border-muted)",
                  background: "var(--bg)",
                  color: "var(--fg)",
                  fontSize: 12,
                  fontWeight: 500,
                  textDecoration: "none",
                  fontFamily: "inherit",
                }}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M4 2h6l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
                  <path d="M10 2v3h3M6 9h4M6 11h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                {locale === "en" ? "Generate report" : "Bericht erstellen"}
              </a>
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--fg-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
          <h2
            style={{
              margin: "12px 0 0",
              fontSize: 24,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
            }}
          >
            {title}
          </h2>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              fontSize: 12,
              color: "var(--fg-muted)",
            }}
          >
            <button
              onClick={() => onOpenEntity?.(rec.entity_id)}
              disabled={!onOpenEntity}
              title={onOpenEntity ? `Open ${rec.entity_name}'s profile` : rec.entity_name}
              style={{
                padding: "2px 8px",
                background: onOpenEntity ? "var(--brand-wash)" : "var(--bg-elevated)",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                border: "1px solid " + (onOpenEntity ? "var(--brand-line)" : "transparent"),
                color: onOpenEntity ? "var(--brand)" : "var(--fg-muted)",
                cursor: onOpenEntity ? "pointer" : "default",
              }}
            >
              {rec.entity_name}
              {onOpenEntity && <span style={{ marginLeft: 6, opacity: 0.7 }}>→</span>}
            </button>
            <span
              style={{
                padding: "2px 8px",
                background: "var(--bg-elevated)",
                borderRadius: 4,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
            >
              {rec.entity_type}
            </span>
            {rec.entity_reputation && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11.5,
                  color:
                    rec.entity_reputation.band === "trusted"
                      ? "var(--rep-trusted)"
                      : rec.entity_reputation.band === "avoid"
                        ? "var(--rep-avoid)"
                        : "var(--fg-muted)",
                  letterSpacing: "-0.005em",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background:
                      rec.entity_reputation.band === "trusted"
                        ? "var(--rep-trusted)"
                        : rec.entity_reputation.band === "avoid"
                          ? "var(--rep-avoid)"
                          : "var(--rep-neutral)",
                  }}
                />
                {bandLabelFor(rec.entity_type, rec.entity_reputation.band, rec.entity_reputation.score)}
              </span>
            )}
            {/* Related-property chips — fetch from the entity's reputation
                 (related_units is computed server-side). Lets the user jump
                 from a tenant/owner incident straight to the unit profile. */}
            {rec.entity_reputation?.related_units?.slice(0, 2).map((unitId) => (
              <button
                key={unitId}
                onClick={() => onOpenEntity?.(unitId)}
                disabled={!onOpenEntity}
                title={`Open ${unitId}`}
                style={{
                  padding: "2px 8px",
                  background: "var(--bg-elevated)",
                  borderRadius: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  border: "1px solid var(--border-muted)",
                  color: onOpenEntity ? "var(--brand)" : "var(--fg-muted)",
                  cursor: onOpenEntity ? "pointer" : "default",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <span style={{ color: "var(--fg-dim)", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.04 }}>
                  {rec.entity_type === "owner" ? "owns" : "lives in"}
                </span>
                {unitId.replace(/^unit:/, "")}
                {onOpenEntity && <span style={{ opacity: 0.7 }}>→</span>}
              </button>
            ))}
          </div>

          {/* Status bar */}
          <div
            style={{
              marginTop: 16,
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 11,
              color: "var(--fg-muted)",
            }}
          >
            <span className="mono" style={{ fontWeight: 500, color: "var(--fg)" }}>
              Step {currentStep} / {totalSteps}
            </span>
            <span style={{ flex: 1, fontStyle: "italic", fontFamily: "var(--font-serif)", color: "var(--fg-muted)" }}>
              {stepLabel}
            </span>
            <div style={{ display: "flex", gap: 3, width: 140 }}>
              {Array.from({ length: totalSteps }, (_, i) => (
                <span
                  key={i}
                  style={{
                    flex: 1,
                    height: 3,
                    borderRadius: 1.5,
                    background: i < currentStep ? sevColor : "var(--border-muted)",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
        </div>

        {/* Body — full-page two-column with comfortable max-width */}
        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
            minHeight: 0,
            maxWidth: 1480,
            width: "100%",
            margin: "0 auto",
          }}
        >
          {/* Timeline */}
          <div
            style={{
              overflow: "auto",
              padding: "20px 24px 60px",
              borderRight: "1px solid var(--border)",
            }}
          >
            <p
              className="mono"
              style={{
                margin: "0 0 14px",
                fontSize: 11,
                color: "var(--fg-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Timeline · {items.length} {items.length === 1 ? "step" : "steps"} · newest first
            </p>

            <p style={{ fontSize: 13, color: "var(--fg-muted)", margin: "0 0 20px", lineHeight: 1.55 }}>
              {summary}
            </p>

            {resolved && (
              <TimelineItemView
                item={{
                  ts: new Date().toISOString(),
                  actor: "manager",
                  actorName: "You",
                  title:
                    locale === "en"
                      ? "Marked resolved · status updated to resolved"
                      : "Als erledigt markiert · Status auf erledigt aktualisiert",
                  excerpt:
                    locale === "en"
                      ? "Fact written to Hausbuch · superseded incident.status=reported."
                      : "Fakt in Hausbuch geschrieben · ersetzt incident.status=reported.",
                  kind: "user",
                }}
                justNow
              />
            )}
            {sent && (
              <TimelineItemView
                item={{
                  ts: new Date().toISOString(),
                  actor: "manager",
                  actorName: "You",
                  title: locale === "en" ? "Reply sent" : "Antwort gesendet",
                  excerpt: draft?.body?.slice(0, 120),
                  kind: "outbound",
                }}
                justNow
              />
            )}

            {items.map((it, i) => (
              <TimelineItemView key={i} item={it} />
            ))}

            {items.length === 0 && (
              <p style={{ color: "var(--fg-dim)", fontSize: 12 }}>No prior steps recorded.</p>
            )}
          </div>

          {/* Draft + actions */}
          <div style={{ overflow: "auto", padding: "20px 22px 60px", background: "var(--bg-elevated)" }}>
            <p
              className="mono"
              style={{
                margin: "0 0 12px",
                fontSize: 11,
                color: "var(--fg-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Suggested next action
            </p>

            {!resolved ? (
              <>
                {drafting && (
                  <p className="pulse mono" style={{ fontSize: 12, color: "var(--fg-dim)" }}>
                    drafting…
                  </p>
                )}
                {draft && !draft.error && draft.body && (
                  <DraftCard
                    draft={draft}
                    onSend={handleSend}
                    sending={sending}
                    sent={sent}
                    locale={locale}
                  />
                )}
                {draft?.error && (
                  <p style={{ fontSize: 12, color: "var(--severity-critical)" }}>
                    Draft failed: {draft.error}
                  </p>
                )}
                {!drafting && !draft && (
                  <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
                    No draft prepared for this recommendation.
                  </p>
                )}

                {/* Action row */}
                <div
                  style={{
                    marginTop: 16,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <ActionBtn
                    label={locale === "en" ? "Dispatch handyman" : "Handwerker beauftragen"}
                    onClick={onDispatch}
                  />
                  <button
                    onClick={onResolve}
                    style={{
                      marginLeft: "auto",
                      padding: "7px 14px",
                      border: "1px solid var(--border-muted)",
                      borderRadius: 6,
                      background: "transparent",
                      color: "var(--fg-muted)",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {locale === "en" ? "Mark resolved" : "Als erledigt"}
                  </button>
                </div>

                {/* Bitemporal facts — editable, newest first */}
                {rec.facts && rec.facts.length > 0 && (
                  <div style={{ marginTop: 24 }}>
                    <p
                      className="mono"
                      style={{
                        margin: "0 0 10px",
                        fontSize: 11,
                        color: "var(--fg-dim)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      Bitemporal facts ({rec.facts.length}) · newest first · click value to edit
                    </p>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      {(() => {
                        // Dedupe by (predicate, value) — multiple emails reporting
                        // the same incident type produce duplicate fact rows.
                        // Show one row per (predicate, value), newest first,
                        // with a "× N" badge for the count.
                        const sorted = [...rec.facts].sort((a, b) =>
                          b.known_from.localeCompare(a.known_from),
                        );
                        const seen = new Set<string>();
                        const groups: Array<{
                          fact: typeof rec.facts[number];
                          count: number;
                        }> = [];
                        const counts = new Map<string, number>();
                        for (const f of sorted) {
                          const key = `${f.predicate}\0${f.value}`;
                          counts.set(key, (counts.get(key) ?? 0) + 1);
                          if (!seen.has(key)) {
                            seen.add(key);
                            groups.push({ fact: f, count: 0 });
                          }
                        }
                        for (const g of groups) {
                          g.count = counts.get(`${g.fact.predicate}\0${g.fact.value}`) ?? 1;
                        }
                        return groups.map((g, i) => (
                          <FactRow
                            key={`${g.fact.predicate}-${g.fact.value}-${i}`}
                            entity={rec.entity_id}
                            predicate={g.fact.predicate}
                            initialValue={g.fact.value}
                            knownFrom={g.fact.known_from}
                            initialValidFrom={g.fact.valid_from ?? null}
                            initialValidTo={g.fact.valid_to ?? null}
                            sourceTitle={g.fact.source_title}
                            occurrences={g.count}
                          />
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div
                style={{
                  padding: 32,
                  textAlign: "center",
                  border: "1px dashed var(--border)",
                  borderRadius: 12,
                  marginTop: 20,
                }}
              >
                <p
                  className="serif-italic"
                  style={{ fontSize: 26, margin: 0, color: "var(--fg-muted)" }}
                >
                  Resolved.
                </p>
                <p style={{ fontSize: 13, color: "var(--fg-dim)", marginTop: 8 }}>
                  Fact written to Hausbuch · status changed to closed.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Timeline item ────────────────────────────────────────────────────────────

type SourceRow = {
  id: string;
  kind: string;
  title: string;
  from_addr?: string;
  to_addr?: string;
  ingested_at: string;
  raw_excerpt: string;
  category?: string;
  direction?: string;
};

function TimelineItemView({
  item,
  justNow,
}: {
  item: {
    ts: string;
    actor: string;
    actorName: string;
    title: string;
    excerpt?: string;
    kind: "inbound" | "outbound" | "system" | "user";
    source_id?: string;
  };
  justNow?: boolean;
}) {
  const d = new Date(item.ts);
  const date = justNow ? "Just now" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const time = justNow ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const kindColor: Record<string, string> = {
    inbound: "var(--severity-medium)",
    outbound: "var(--brand)",
    system: "var(--fg-dim)",
    user: "var(--fg)",
  };
  const kindLabel: Record<string, string> = {
    inbound: "in",
    outbound: "out",
    system: "system",
    user: "you",
  };

  const isEmail = item.kind === "inbound" || item.kind === "outbound";
  const expandable = isEmail && !!item.source_id;

  const [expanded, setExpanded] = useState(false);
  const [source, setSource] = useState<SourceRow | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (!expandable) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (!source && item.source_id) {
      setLoading(true);
      try {
        const r = await fetch(`/api/source/${encodeURIComponent(item.source_id)}`);
        if (r.ok) {
          const data = (await r.json()) as { source: SourceRow };
          setSource(data.source);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "70px 14px 1fr",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px dashed var(--border-muted)",
        cursor: expandable ? "pointer" : "default",
      }}
      onClick={toggle}
      role={expandable ? "button" : undefined}
      aria-expanded={expandable ? expanded : undefined}
    >
      <div>
        <div className="mono" style={{ fontSize: 11, color: "var(--fg)", lineHeight: 1.3 }}>
          {date}
        </div>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 2 }}>
          {time}
        </div>
      </div>
      <div style={{ paddingTop: 4 }}>
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 999,
            background: kindColor[item.kind],
          }}
        />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "baseline", marginBottom: 3 }}>
          <span style={{ fontSize: 12, color: "var(--fg)", fontWeight: 500 }}>
            {item.actorName}
          </span>
          <span
            className="mono"
            style={{
              fontSize: 9,
              padding: "1px 5px",
              borderRadius: 3,
              background: "var(--bg-elevated)",
              color: kindColor[item.kind],
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {kindLabel[item.kind]}
          </span>
          {expandable && (
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: 10,
                color: "var(--fg-dim)",
              }}
            >
              {expanded ? "▾ collapse" : "▸ open email"}
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--fg)", lineHeight: 1.45 }}>
          {item.title}
        </p>
        {!expanded && item.excerpt && (
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: "var(--fg-muted)",
              lineHeight: 1.5,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}
          >
            {item.excerpt}
          </p>
        )}
        {expanded && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              marginTop: 8,
              padding: "12px 14px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12.5,
              lineHeight: 1.6,
              color: "var(--fg)",
            }}
          >
            {loading && (
              <p className="mono pulse" style={{ margin: 0, fontSize: 11, color: "var(--fg-dim)" }}>
                ▸▸▸ loading source…
              </p>
            )}
            {!loading && source && (
              <>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    marginBottom: 10,
                    paddingBottom: 10,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {source.from_addr && (
                    <KV k="From" v={source.from_addr} />
                  )}
                  {source.to_addr && <KV k="To" v={source.to_addr} />}
                  <KV k="Subject" v={source.title} />
                  <KV k="Received" v={new Date(source.ingested_at).toLocaleString("en-GB")} />
                  {source.category && <KV k="Category" v={source.category} />}
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-sans)",
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    color: "var(--fg)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {source.raw_excerpt}
                </pre>
              </>
            )}
            {!loading && !source && item.excerpt && (
              <p style={{ margin: 0, color: "var(--fg-muted)" }}>{item.excerpt}</p>
            )}
            {!loading && !source && !item.excerpt && (
              <p style={{ margin: 0, color: "var(--fg-dim)", fontSize: 11 }}>
                Source body unavailable.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8, fontSize: 11.5 }}>
      <span className="mono" style={{ color: "var(--fg-dim)" }}>{k}</span>
      <span className="mono" style={{ color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis" }}>
        {v}
      </span>
    </div>
  );
}

// ── Draft card ───────────────────────────────────────────────────────────────

function DraftCard({
  draft,
  onSend,
  sending,
  sent,
  locale,
}: {
  draft: DraftResult;
  onSend: () => void;
  sending: boolean;
  sent: boolean;
  locale: "en" | "de";
}) {
  return (
    <div
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 4 }}>
        <Field k="To" v={`${draft.to ?? ""} <${draft.to_email ?? ""}>`} mono />
        <Field k="Subject" v={draft.subject ?? ""} />
      </div>
      <pre
        style={{
          margin: 0,
          padding: "12px 14px",
          fontSize: 12.5,
          lineHeight: 1.55,
          color: "var(--fg)",
          fontFamily: "var(--font-sans)",
          whiteSpace: "pre-wrap",
          maxHeight: 360,
          overflow: "auto",
        }}
      >
        {draft.body}
      </pre>
      <div
        style={{
          padding: "10px 14px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          fontSize: 11,
          color: "var(--fg-dim)",
        }}
      >
        <span className="mono" style={{ flex: 1 }}>
          {draft.model ? `Drafted by ${draft.model}` : "Drafted"}{draft.latency_ms ? ` · ${draft.latency_ms}ms` : ""}
        </span>
        <button
          onClick={onSend}
          disabled={sending || sent}
          style={{
            padding: "6px 14px",
            background: sent ? "var(--bg-hover)" : "var(--brand)",
            color: sent ? "var(--fg-muted)" : "white",
            border: "1px solid " + (sent ? "var(--border-muted)" : "var(--brand)"),
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            cursor: sending || sent ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {sent ? (locale === "en" ? "Sent ✓" : "Gesendet ✓") : sending ? "Sending…" : locale === "en" ? "Send reply" : "Antwort senden"}
        </button>
      </div>
    </div>
  );
}

/**
 * Tiny non-cryptographic hash so the cache key stays short. djb2.
 */
function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Render a reputation as a friendly label per entity kind.
 *   contractors  → "★★★★☆ 4.0/5"        (operational performance)
 *   tenants/owners → categorical band     (Excellent · Reliable · Watch · …)
 *   weg/building/unit → just the band, score is meaningless at that level
 */
function bandLabelFor(
  entityType: string,
  band: "trusted" | "neutral" | "avoid" | string,
  score: number,
): string {
  if (entityType === "contractor") {
    const stars = Math.round(score * 5 * 2) / 2;
    return `${stars.toFixed(1)} / 5 ★`;
  }
  if (entityType === "tenant" || entityType === "owner") {
    if (score >= 0.85) return "Excellent";
    if (score >= 0.7) return "Reliable";
    if (score >= 0.5) return "Fine so far";
    if (score >= 0.3) return "Watch";
    return "Concerning";
  }
  return band;
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 11.5 }}>
      <span style={{ color: "var(--fg-dim)", width: 60, flexShrink: 0 }}>{k}</span>
      <span
        className={mono ? "mono" : ""}
        style={{
          color: "var(--fg)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {v}
      </span>
    </div>
  );
}

// ── Fact row (inline edit) ───────────────────────────────────────────────────

// Predicates whose value should be picked from a fixed list. Mirrored from
// src/lib/predicate-schemas.ts so the client can render a select without an
// extra API round-trip.
const ENUM_VALUES: Record<string, readonly string[]> = {
  "incident.type": [
    "water_damage",
    "mold",
    "lock_issue",
    "heating",
    "elevator",
    "noise",
    "electrical",
    "other",
  ],
  "incident.status": [
    "reported",
    "in_progress",
    "awaiting_contractor",
    "resolved",
    "escalated",
    "closed",
  ],
};

const BOOLEAN_PREDICATES = new Set([
  "tenancy.mieterwechsel",
  "financial.mahnung",
  "legal.kuendigung",
  "legal.mietminderung",
  "legal.verkaufsabsicht",
]);

const DATE_PREDICATES = new Set([
  "tenancy.start",
  "tenancy.end",
  "condition.last_inspection",
  "condition.next_inspection",
]);

function FactRow({
  entity,
  predicate,
  initialValue,
  knownFrom,
  initialValidFrom,
  initialValidTo,
  sourceTitle,
  occurrences = 1,
}: {
  entity: string;
  predicate: string;
  initialValue: string;
  knownFrom: string;
  initialValidFrom?: string | null;
  initialValidTo?: string | null;
  sourceTitle: string;
  occurrences?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  // Pre-fill the lifetime fields with the current fact's interval so the
  // user can see what's already there and edit from a real starting point.
  const isoDate = (s: string | null | undefined) =>
    s ? s.slice(0, 10) : "";
  const [validFrom, setValidFrom] = useState(isoDate(initialValidFrom));
  const [validTo, setValidTo] = useState(isoDate(initialValidTo));
  const [savedValue, setSavedValue] = useState<string | null>(null);
  const [savedLifetime, setSavedLifetime] = useState<{ from: string; to: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Scope choice when there are duplicates: "all" supersedes every matching
  // live fact (the historical default), "latest" supersedes only the most
  // recent one — useful when the user genuinely meant to correct ONE report
  // rather than batch-correct the whole chain.
  const [scope, setScope] = useState<"all" | "latest">("all");

  const enumValues = ENUM_VALUES[predicate];
  const isBoolean = BOOLEAN_PREDICATES.has(predicate);
  const isDate = DATE_PREDICATES.has(predicate);

  const save = async () => {
    setError(null);
    const initialFromIso = isoDate(initialValidFrom);
    const initialToIso = isoDate(initialValidTo);
    if (
      value === initialValue &&
      validFrom === initialFromIso &&
      validTo === initialToIso
    ) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const effectiveScope = occurrences > 1 ? scope : "all";
      const body: Record<string, string> = {
        entity,
        predicate,
        value,
        // "previous_value" tells /api/correct which prior live row(s) to
        // supersede. When the user chose "latest", we omit it and pass a
        // scope hint so the server only closes the most recent matching row.
        ...(effectiveScope === "all" ? { previous_value: initialValue } : {}),
        scope: effectiveScope,
        note:
          occurrences > 1 && effectiveScope === "all"
            ? `Manager corrected ${occurrences} duplicate ${predicate} facts from "${initialValue}" to "${value}".`
            : occurrences > 1
              ? `Manager corrected the latest ${predicate} fact from "${initialValue}" to "${value}" (other ${occurrences - 1} reports kept).`
              : `Manager corrected ${predicate} from "${initialValue}" to "${value}".`,
      };
      if (validFrom) body.valid_from = validFrom;
      if (validTo) body.valid_to = validTo;

      const res = await fetch("/api/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setSavedValue(value);
        if (validFrom || validTo) {
          setSavedLifetime({ from: validFrom, to: validTo });
        }
        setEditing(false);
      } else {
        setError(
          data.error
            ? data.allowed
              ? `${data.error} Allowed: ${(data.allowed as string[]).join(", ")}.`
              : data.error
            : "Save failed.",
        );
      }
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setValue(initialValue);
    setValidFrom(isoDate(initialValidFrom));
    setValidTo(isoDate(initialValidTo));
    setError(null);
    setEditing(false);
  };

  return (
    <div
      style={{
        padding: "8px 0",
        borderBottom: "1px dashed var(--border-muted)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 12,
          alignItems: "baseline",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--fg)" }}>
              {predicate}
            </span>
            <span style={{ color: "var(--fg-dim)", fontSize: 11 }}>=</span>

            {!editing && (
              <button
                onClick={() => setEditing(true)}
                title="Click to correct"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  padding: "2px 6px",
                  border: "1px solid transparent",
                  borderRadius: 4,
                  background: savedValue ? "var(--brand-wash)" : "transparent",
                  color: savedValue ? "var(--brand)" : "var(--fg)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = savedValue ? "var(--brand-wash)" : "transparent")
                }
              >
                {savedValue ?? value}
                <span style={{ marginLeft: 6, color: "var(--fg-dim)", fontSize: 10 }}>✎</span>
              </button>
            )}
            {!editing && occurrences > 1 && (
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: "var(--bg-elevated)",
                  color: "var(--fg-muted)",
                  border: "1px solid var(--border-muted)",
                }}
                title={`Reported ${occurrences} times across this entity's history`}
              >
                ×{occurrences}
              </span>
            )}

            {editing && enumValues && (
              <select
                value={value}
                disabled={saving}
                onChange={(e) => setValue(e.target.value)}
                style={inputStyle}
                autoFocus
              >
                {enumValues.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            {editing && isBoolean && (
              <select
                value={value}
                disabled={saving}
                onChange={(e) => setValue(e.target.value)}
                style={inputStyle}
                autoFocus
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            )}
            {editing && !enumValues && !isBoolean && (
              <input
                autoFocus
                type={isDate ? "date" : "text"}
                value={value}
                disabled={saving}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    save();
                  }
                  if (e.key === "Escape") cancel();
                }}
                style={inputStyle}
              />
            )}
          </div>

          {/* Edit scope toggle — only meaningful when there are duplicates */}
          {editing && occurrences > 1 && (
            <div
              style={{
                marginTop: 8,
                padding: "6px 10px",
                borderRadius: 6,
                background: "rgba(180,83,9,0.08)",
                border: "1px solid rgba(180,83,9,0.25)",
                fontSize: 11,
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--fg-dim)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                applies to
              </span>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input
                  type="radio"
                  name={`scope-${entity}-${predicate}`}
                  checked={scope === "all"}
                  onChange={() => setScope("all")}
                />
                <span style={{ color: scope === "all" ? "var(--fg)" : "var(--fg-muted)" }}>
                  all <strong>{occurrences}</strong> reports
                </span>
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                <input
                  type="radio"
                  name={`scope-${entity}-${predicate}`}
                  checked={scope === "latest"}
                  onChange={() => setScope("latest")}
                />
                <span style={{ color: scope === "latest" ? "var(--fg)" : "var(--fg-muted)" }}>
                  latest only (keep {occurrences - 1} prior)
                </span>
              </label>
            </div>
          )}

          {/* Lifetime editor — visible only when editing */}
          {editing && (
            <div
              style={{
                marginTop: 6,
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span
                className="mono"
                style={{ fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}
              >
                lifetime
              </span>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--fg-dim)" }}>
                  from
                </span>
                <input
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  style={dateInputStyle}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--fg-dim)" }}>
                  to
                </span>
                <input
                  type="date"
                  value={validTo}
                  onChange={(e) => setValidTo(e.target.value)}
                  style={dateInputStyle}
                  placeholder="open-ended"
                />
              </label>
              <span
                className="mono"
                style={{ fontSize: 10, color: "var(--fg-dim)", fontStyle: "italic" }}
              >
                empty = no change
              </span>
            </div>
          )}

          {/* Action buttons + provenance */}
          {editing ? (
            <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              <button onClick={save} disabled={saving} style={primaryBtn}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={cancel} disabled={saving} style={ghostBtn}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 3 }}>
              {occurrences > 1
                ? `${occurrences} reports · most recent via ${sourceTitle.slice(0, 40)}`
                : `via ${sourceTitle.slice(0, 50)}`}
              {savedValue && <span style={{ color: "var(--brand)", marginLeft: 8 }}>· corrected{occurrences > 1 ? ` (${occurrences} rows)` : ""}</span>}
              {savedLifetime && (
                <span style={{ color: "var(--brand)", marginLeft: 8 }}>
                  · lifetime updated
                </span>
              )}
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "var(--severity-critical)",
                fontFamily: "var(--font-sans)",
              }}
            >
              ⚠ {error}
            </div>
          )}
        </div>
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", whiteSpace: "nowrap" }}>
          {new Date(knownFrom).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "2px 6px",
  border: "1px solid var(--brand)",
  borderRadius: 4,
  background: "var(--bg)",
  color: "var(--fg)",
  outline: "none",
  minWidth: 140,
};

const dateInputStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  padding: "2px 4px",
  border: "1px solid var(--border-muted)",
  borderRadius: 4,
  background: "var(--bg)",
  color: "var(--fg)",
  outline: "none",
};

const primaryBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 500,
  background: "var(--brand)",
  color: "white",
  border: "1px solid var(--brand)",
  borderRadius: 5,
  cursor: "pointer",
  fontFamily: "inherit",
};

const ghostBtn: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 500,
  background: "transparent",
  color: "var(--fg-muted)",
  border: "1px solid var(--border-muted)",
  borderRadius: 5,
  cursor: "pointer",
  fontFamily: "inherit",
};

// ── Action button ────────────────────────────────────────────────────────────

function ActionBtn({
  label,
  variant,
  onClick,
}: {
  label: string;
  variant?: "danger";
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        padding: "7px 12px",
        border: "1px solid var(--border-muted)",
        borderRadius: 6,
        background: "var(--bg)",
        color: variant === "danger" ? "var(--severity-critical)" : "var(--fg)",
        fontSize: 12,
        fontWeight: 500,
        cursor: onClick ? "pointer" : "default",
        opacity: onClick ? 1 : 0.6,
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}
