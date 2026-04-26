// path: src/components/EntityProfilePanel.tsx
"use client";

import { useEffect, useState } from "react";

type Reputation = {
  score: number;
  band: "trusted" | "neutral" | "avoid";
  incidents_open: number;
  incidents_total: number;
  mahnung_count: number;
  last_incident_at: string | null;
};

type SourceRow = {
  id: string;
  kind: string;
  title: string;
  ingested_at: string;
  from_addr: string | null;
  to_addr: string | null;
};

type AuditEntry = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  entity: string | null;
  target: string | null;
};

type HistoryEntry = {
  unit_id: string;
  source_id: string;
  source_title: string | null;
  at: string;
};

type QueryStats = {
  week: number;
  month: number;
  up: number;
  down: number;
};

type IncidentRow = {
  type: string;
  count: number;
  latest_status: string | null;
  occurrences: Array<{ source_id: string; source_title: string; date: string }>;
};

type Profile = {
  id: string;
  name: string;
  type: string;
  meta?: Record<string, unknown>;
  identity: Record<string, string>;
  reputation?: Reputation;
  tenants?: Array<{ id: string; name: string }>;
  owners?: Array<{ id: string; name: string }>;
  units?: Array<{ id: string; name: string }>;
  history?: HistoryEntry[];
  related_units?: string[];
  sources: SourceRow[];
  audit: AuditEntry[];
  query_stats?: QueryStats;
  incidents?: IncidentRow[];
};

const BAND_COLOR: Record<string, string> = {
  trusted: "var(--rep-trusted)",
  neutral: "var(--rep-neutral)",
  avoid: "var(--rep-avoid)",
};

const TYPE_LABEL: Record<string, string> = {
  tenant: "Tenant profile",
  owner: "Owner profile",
  unit: "Unit profile",
  building: "Building profile",
  weg: "WEG profile",
  contractor: "Contractor profile",
};

/**
 * Minimal shape of a recommendation as the profile panel needs it.
 * Matches what /api/recommendations returns; kept narrow so the panel
 * doesn't pull in the full recs.ts type graph.
 */
type ProfileRec = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  entity_id: string;
  entity_name: string;
  category: string;
  title: string;
  title_en?: string;
  summary: string;
  summary_en?: string;
  email_chain?: Array<{ source_id: string; title: string; date: string }>;
  facts?: Array<{ predicate: string; value: string; source_title: string; known_from: string }>;
  actions?: Array<{ type: string; label: string; label_de: string; draft_context?: unknown }>;
};

export function EntityProfilePanel({
  open,
  entityId,
  onClose,
  onOpenEntity,
  onOpenCase,
}: {
  open: boolean;
  entityId: string | null;
  onClose: () => void;
  onOpenEntity?: (id: string) => void;
  /**
   * Fired when the user clicks an open case in the profile. The full rec
   * is passed back so the parent can hand it to its StreamPanel without
   * re-fetching. The dashboard wires this to openStream(rec).
   */
  onOpenCase?: (rec: ProfileRec) => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [openCases, setOpenCases] = useState<ProfileRec[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !entityId) return;
    let cancelled = false;
    setLoading(true);
    setProfile(null);
    setOpenCases([]);
    fetch(`/api/entity-profile/${encodeURIComponent(entityId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setProfile(d.profile ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Pull the open cases for this entity from the live recommendations
    // engine. Using sessionStorage as a fast-path so re-opening the
    // profile is instant; refresh from the network in the background.
    try {
      const cached = sessionStorage.getItem("hausbuch:recs:v1");
      if (cached) {
        const parsed = JSON.parse(cached) as ProfileRec[];
        if (Array.isArray(parsed)) {
          setOpenCases(parsed.filter((r) => r.entity_id === entityId));
        }
      }
    } catch {
      /* sessionStorage disabled — fall through */
    }
    fetch("/api/recommendations")
      .then((r) => r.json())
      .then((d: { recommendations: ProfileRec[] }) => {
        if (cancelled) return;
        const all = d.recommendations ?? [];
        setOpenCases(all.filter((r) => r.entity_id === entityId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, entityId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const headerLabel = profile ? TYPE_LABEL[profile.type] ?? "Profile" : "Profile";

  if (!open && !entityId) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: open ? "rgba(28,26,22,0.55)" : "transparent",
        opacity: open ? 1 : 0,
        transition: "opacity 200ms",
        pointerEvents: open ? "auto" : "none",
        zIndex: 110,
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: "3vh 3vw",
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 1320,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 30px 90px rgba(28,26,22,0.30)",
          transform: open ? "scale(1) translateY(0)" : "scale(0.97) translateY(8px)",
          opacity: open ? 1 : 0,
          transition:
            "transform 220ms cubic-bezier(0.2,0.8,0.2,1), opacity 200ms",
          display: "flex",
          flexDirection: "column",
          zIndex: 120,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 28px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p
              className="mono"
              style={{
                margin: "0 0 4px",
                fontSize: 11,
                color: "var(--fg-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {headerLabel}
            </p>
            <h2
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 500,
                letterSpacing: "-0.02em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {profile?.name ?? (loading ? "Loading…" : "—")}
            </h2>
            {profile && (
              <p
                className="mono"
                style={{ margin: "4px 0 0", fontSize: 11, color: "var(--fg-dim)" }}
              >
                {profile.id}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {entityId && (
              <a
                href={`/context/${encodeURIComponent(entityId)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the rendered Context.md with timeline + provenance"
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
                  <path d="M3 4h10M3 8h10M3 12h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                View Context.md
              </a>
            )}
            {entityId && (
              <a
                href={`/api/report/entity/${encodeURIComponent(entityId)}?download=1`}
                target="_blank"
                rel="noopener noreferrer"
                title="Generate Markdown report"
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
                Generate report
              </a>
            )}
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
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "inherit",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "20px 28px 60px" }}>
          {loading && (
            <p className="mono pulse" style={{ fontSize: 12, color: "var(--fg-dim)" }}>
              ▸▸▸ loading profile…
            </p>
          )}
          {!loading && !profile && (
            <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>Entity not found.</p>
          )}
          {!loading && profile && (
            <>
              {/* Identity block */}
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 24 }}>
                <Avatar name={profile.name} type={profile.type} size={88} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <KVRow k="Type" v={prettyType(profile.type)} />
                  {Object.entries(profile.identity).map(([k, v]) => (
                    <KVRow key={k} k={prettyKey(k)} v={v} mono={isMonoKey(k)} />
                  ))}
                  {profile.meta && Object.keys(profile.meta).length > 0 && (
                    <MetaRows meta={profile.meta} />
                  )}
                  {profile.reputation && profile.type === "contractor" && (
                    <div style={{ marginTop: 10 }}>
                      <StarRating reputation={profile.reputation} />
                    </div>
                  )}
                  {profile.reputation &&
                    (profile.type === "tenant" || profile.type === "owner") && (
                      <div style={{ marginTop: 10 }}>
                        <ReputationBand reputation={profile.reputation} />
                      </div>
                    )}
                  {profile.query_stats &&
                    profile.query_stats.month > 0 &&
                    !["unit", "building", "weg"].includes(profile.type) && (
                      <div style={{ marginTop: 8 }}>
                        <QueryStatsChip stats={profile.query_stats} />
                      </div>
                    )}
                </div>
              </div>

              {/* Open cases — clickable cards above the type-specific
                  sections so the manager can jump straight from a
                  profile to the email thread + action ladder for any
                  open case on this entity. Same data shape /dashboard
                  uses; the StreamPanel handles thread + follow-ups. */}
              {openCases.length > 0 && (
                <OpenCasesList
                  cases={openCases}
                  onOpen={(rec) => {
                    onOpenCase?.(rec);
                  }}
                />
              )}

              {/* Type-specific sections */}
              {profile.type === "tenant" && (
                <TenantSections profile={profile} onOpenEntity={onOpenEntity} />
              )}
              {profile.type === "owner" && (
                <OwnerSections profile={profile} onOpenEntity={onOpenEntity} />
              )}
              {profile.type === "unit" && (
                <UnitSections profile={profile} onOpenEntity={onOpenEntity} />
              )}
              {(profile.type === "building" || profile.type === "weg") && (
                <ContainerSections profile={profile} onOpenEntity={onOpenEntity} />
              )}

              {/* Recent sources — common to all */}
              <Section title="Recent emails & documents">
                {profile.sources.length === 0 ? (
                  <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>No sources recorded.</p>
                ) : (
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      overflow: "hidden",
                      background: "var(--bg-elevated)",
                    }}
                  >
                    {profile.sources.slice(0, 12).map((s, i) => (
                      <div
                        key={s.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "100px 1fr 80px",
                          gap: 12,
                          padding: "10px 14px",
                          fontSize: 12,
                          alignItems: "baseline",
                          borderBottom:
                            i < Math.min(profile.sources.length, 12) - 1
                              ? "1px solid var(--border-muted)"
                              : "none",
                        }}
                      >
                        <span className="mono" style={{ color: "var(--fg-dim)", fontSize: 10 }}>
                          {s.ingested_at.slice(0, 10)}
                        </span>
                        <span
                          style={{
                            color: "var(--fg)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={s.title}
                        >
                          {s.title.replace(/^(re|fwd|aw|wg):\s*/i, "")}
                        </span>
                        <span
                          className="mono"
                          style={{
                            color: "var(--fg-dim)",
                            fontSize: 10,
                            textTransform: "uppercase",
                            textAlign: "right",
                          }}
                        >
                          {s.kind}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>

              {/* Audit log */}
              {profile.audit.length > 0 && (
                <Section title="Activity">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {profile.audit.slice(0, 10).map((a) => (
                      <div
                        key={a.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "100px 100px 1fr",
                          gap: 12,
                          fontSize: 11,
                          padding: "4px 0",
                        }}
                      >
                        <span className="mono" style={{ color: "var(--fg-dim)" }}>
                          {a.ts.slice(0, 10)}
                        </span>
                        <span className="mono" style={{ color: "var(--brand)" }}>
                          {a.actor}
                        </span>
                        <span style={{ color: "var(--fg-muted)" }}>{a.action}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── Type-specific sections ───────────────────────────────────────────────────

/**
 * List of open cases for this entity. Each card shows severity tick,
 * title, summary, latest email subject + date, and a count of follow-up
 * messages in the thread. Click → onOpen(rec), which the dashboard
 * routes to the StreamPanel (email chain + action ladder).
 */
function OpenCasesList({
  cases,
  onOpen,
}: {
  cases: ProfileRec[];
  onOpen: (rec: ProfileRec) => void;
}) {
  const sevColor: Record<ProfileRec["severity"], string> = {
    critical: "var(--severity-critical)",
    high: "var(--severity-high)",
    medium: "var(--severity-medium)",
    low: "var(--severity-low)",
  };
  const sevOrder: Record<ProfileRec["severity"], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  const sorted = [...cases].sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  return (
    <Section title={`Open cases · ${cases.length}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sorted.map((rec) => {
          const chain = rec.email_chain ?? [];
          const latest = chain[0];
          return (
            <button
              key={rec.id}
              type="button"
              onClick={() => onOpen(rec)}
              className="transition-colors"
              style={{
                display: "grid",
                gridTemplateColumns: "4px 1fr auto",
                gap: 14,
                padding: "12px 14px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.borderColor = "var(--brand)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-elevated)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
              aria-label={`Open case: ${rec.title}`}
            >
              <div
                style={{
                  width: 4,
                  borderRadius: 2,
                  background: sevColor[rec.severity],
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 500,
                    letterSpacing: "-0.005em",
                    color: "var(--fg)",
                    marginBottom: 4,
                  }}
                >
                  {rec.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--fg-muted)",
                    lineHeight: 1.45,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {rec.summary}
                </div>
                {latest && (
                  <div
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      color: "var(--fg-dim)",
                      marginTop: 6,
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      alignItems: "baseline",
                    }}
                  >
                    <span>{latest.date.slice(0, 10)}</span>
                    <span style={{ color: "var(--fg-muted)" }}>
                      latest: {latest.title}
                    </span>
                    {chain.length > 1 && (
                      <span
                        style={{
                          color: "var(--brand)",
                          padding: "1px 6px",
                          borderRadius: 999,
                          background: "var(--brand-wash)",
                        }}
                      >
                        {chain.length} messages in thread
                      </span>
                    )}
                  </div>
                )}
              </div>
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--brand)",
                  alignSelf: "center",
                  whiteSpace: "nowrap",
                }}
              >
                open →
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function TenantSections({
  profile,
  onOpenEntity,
}: {
  profile: Profile;
  onOpenEntity?: (id: string) => void;
}) {
  const history = profile.history ?? [];
  const currentUnits = profile.related_units ?? [];
  const incidents = profile.incidents ?? [];

  return (
    <>
      {currentUnits.length > 0 && (
        <Section title="Lives in">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {currentUnits.map((u) => (
              <EntityChip key={u} id={u} onOpen={onOpenEntity} prominent />
            ))}
          </div>
        </Section>
      )}

      {incidents.length > 0 && (
        <Section title={`Incident timeline · ${incidents.length} type${incidents.length === 1 ? "" : "s"}`}>
          <IncidentTimeline incidents={incidents} />
        </Section>
      )}

      {history.length > 0 && (
        <Section title="Tenancy history">
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "hidden",
              background: "var(--bg-elevated)",
            }}
          >
            {history.slice(0, 8).map((h, i) => (
              <div
                key={`${h.source_id}-${i}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 140px 1fr",
                  gap: 12,
                  padding: "10px 14px",
                  fontSize: 12,
                  alignItems: "baseline",
                  borderBottom:
                    i < Math.min(history.length, 8) - 1
                      ? "1px solid var(--border-muted)"
                      : "none",
                }}
              >
                <span className="mono" style={{ color: "var(--fg-dim)", fontSize: 10 }}>
                  {h.at.slice(0, 10)}
                </span>
                <button
                  onClick={() => onOpenEntity?.(h.unit_id)}
                  className="mono"
                  style={{
                    color: "var(--brand)",
                    fontSize: 11,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: onOpenEntity ? "pointer" : "default",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  {h.unit_id.replace(/^unit:/, "")}
                </button>
                <span
                  style={{
                    color: "var(--fg-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={h.source_title ?? ""}
                >
                  via {h.source_title ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function OwnerSections({
  profile,
  onOpenEntity,
}: {
  profile: Profile;
  onOpenEntity?: (id: string) => void;
}) {
  const units = profile.units ?? [];
  return (
    <Section title={`Properties owned · ${units.length}`}>
      {units.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>No properties recorded.</p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {units.map((u) => (
            <button
              key={u.id}
              onClick={() => onOpenEntity?.(u.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 6,
                border: "1px solid var(--border-muted)",
                background: "var(--bg-elevated)",
                color: "var(--fg)",
                fontSize: 12,
                cursor: onOpenEntity ? "pointer" : "default",
                fontFamily: "inherit",
              }}
            >
              <span className="mono" style={{ color: "var(--fg-dim)", fontSize: 10 }}>
                unit
              </span>
              {u.name}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

function UnitSections({
  profile,
  onOpenEntity,
}: {
  profile: Profile;
  onOpenEntity?: (id: string) => void;
}) {
  const tenants = profile.tenants ?? [];
  const owners = profile.owners ?? [];
  return (
    <>
      <Section title="Current occupants">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <RelationRow label="Tenant" entries={tenants} onOpenEntity={onOpenEntity} />
          <RelationRow label="Owner" entries={owners} onOpenEntity={onOpenEntity} />
        </div>
      </Section>
    </>
  );
}

function ContainerSections({
  profile,
  onOpenEntity,
}: {
  profile: Profile;
  onOpenEntity?: (id: string) => void;
}) {
  const children = profile.units ?? [];
  const childLabel = profile.type === "weg" ? "Buildings" : "Units";
  return (
    <Section title={`${childLabel} · ${children.length}`}>
      {children.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>None recorded.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 8,
          }}
        >
          {children.map((c) => (
            <button
              key={c.id}
              onClick={() => onOpenEntity?.(c.id)}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid var(--border-muted)",
                background: "var(--bg-elevated)",
                color: "var(--fg)",
                fontSize: 12,
                cursor: onOpenEntity ? "pointer" : "default",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <div className="mono" style={{ fontSize: 9, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.04, marginBottom: 2 }}>
                {profile.type === "weg" ? "Building" : "Unit"}
              </div>
              <div style={{ fontWeight: 500, letterSpacing: "-0.005em" }}>{c.name}</div>
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

function RelationRow({
  label,
  entries,
  onOpenEntity,
}: {
  label: string;
  entries: Array<{ id: string; name: string }>;
  onOpenEntity?: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "100px 1fr",
        gap: 12,
        alignItems: "baseline",
        fontSize: 12,
      }}
    >
      <span className="mono" style={{ color: "var(--fg-dim)" }}>{label}</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {entries.length === 0 ? (
          <span style={{ color: "var(--fg-dim)" }}>—</span>
        ) : (
          entries.map((e) => (
            <button
              key={e.id}
              onClick={() => onOpenEntity?.(e.id)}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid var(--border-muted)",
                background: "var(--bg-elevated)",
                color: "var(--brand)",
                fontSize: 12,
                cursor: onOpenEntity ? "pointer" : "default",
                fontFamily: "inherit",
              }}
            >
              {e.name}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function EntityChip({
  id,
  onOpen,
  prominent,
}: {
  id: string;
  onOpen?: (id: string) => void;
  prominent?: boolean;
}) {
  const [kind, name] = id.split(":");
  return (
    <button
      onClick={() => onOpen?.(id)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: prominent ? "8px 14px" : "5px 10px",
        borderRadius: 8,
        border: "1px solid " + (prominent ? "var(--brand-line)" : "var(--border-muted)"),
        background: prominent ? "var(--brand-wash)" : "var(--bg-elevated)",
        color: "var(--fg)",
        fontSize: prominent ? 14 : 12,
        fontWeight: prominent ? 500 : 400,
        cursor: onOpen ? "pointer" : "default",
        fontFamily: "inherit",
      }}
    >
      <span
        className="mono"
        style={{
          color: prominent ? "var(--brand)" : "var(--fg-dim)",
          fontSize: prominent ? 11 : 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {kind}
      </span>
      {name ?? id}
    </button>
  );
}

// Star rating for contractors. Score [0..1] → 0..5 stars at quarter-step.
function StarRating({ reputation }: { reputation: Reputation }) {
  const stars = Math.round(reputation.score * 5 * 2) / 2; // half-star precision
  const full = Math.floor(stars);
  const half = stars - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <div style={{ display: "inline-flex", color: "var(--rep-trusted)" }}>
        {Array.from({ length: full }).map((_, i) => (
          <Star key={`f${i}`} fill="full" />
        ))}
        {half > 0 && <Star fill="half" />}
        {Array.from({ length: empty }).map((_, i) => (
          <Star key={`e${i}`} fill="empty" />
        ))}
      </div>
      <span className="mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
        {stars.toFixed(1)} / 5 · {reputation.incidents_total} job
        {reputation.incidents_total === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function Star({ fill }: { fill: "full" | "half" | "empty" }) {
  // Simple SVG star with full / half / empty fill.
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="halfstar" x1="0" x2="1" y1="0" y2="0">
          <stop offset="50%" stopColor="currentColor" />
          <stop offset="50%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path
        d="M8 1.5l1.96 4.27 4.54.46-3.4 3.05.96 4.5L8 11.5l-4.06 2.27.96-4.5L1.5 6.23l4.54-.46L8 1.5z"
        fill={fill === "full" ? "currentColor" : fill === "half" ? "url(#halfstar)" : "transparent"}
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Categorical reputation band for tenants/owners — judges and managers don't
// want to interpret 0.74 vs 0.81. Five descriptive bands cover the operational
// space.
const TENANT_BANDS: Array<{ min: number; label: string; tone: string; bg: string }> = [
  { min: 0.85, label: "Excellent", tone: "var(--rep-trusted)", bg: "var(--brand-wash)" },
  { min: 0.7, label: "Reliable", tone: "var(--rep-trusted)", bg: "var(--brand-wash)" },
  { min: 0.5, label: "Fine so far", tone: "var(--rep-neutral)", bg: "var(--bg-elevated)" },
  { min: 0.3, label: "Watch", tone: "#b45309", bg: "rgba(180,83,9,0.08)" },
  { min: 0, label: "Concerning", tone: "var(--rep-avoid)", bg: "rgba(153,27,27,0.07)" },
];

function ReputationBand({ reputation }: { reputation: Reputation }) {
  const band =
    TENANT_BANDS.find((b) => reputation.score >= b.min) ?? TENANT_BANDS[TENANT_BANDS.length - 1];
  const negativeNote: string[] = [];
  if (reputation.incidents_open > 0) negativeNote.push(`${reputation.incidents_open} open`);
  if (reputation.mahnung_count > 0) negativeNote.push(`${reputation.mahnung_count} dunning`);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 12px",
        borderRadius: 8,
        background: band.bg,
        border: "1px solid var(--border-muted)",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: band.tone }} />
      <span style={{ color: band.tone, fontSize: 13, fontWeight: 500, letterSpacing: "-0.005em" }}>
        {band.label}
      </span>
      {negativeNote.length > 0 && (
        <span className="mono" style={{ color: "var(--fg-dim)", fontSize: 10 }}>
          · {negativeNote.join(" · ")}
        </span>
      )}
    </div>
  );
}

// Per-incident-type timeline. Click a row → expands into a list of every
// occurrence with date + source. Lets the user verify "incident.type=heating
// × 5" by seeing the 5 dates and the documents that asserted them.
function IncidentTimeline({ incidents }: { incidents: IncidentRow[] }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-elevated)",
        overflow: "hidden",
      }}
    >
      {incidents.map((inc, i) => (
        <IncidentRow key={inc.type} inc={inc} bordered={i < incidents.length - 1} />
      ))}
    </div>
  );
}

function IncidentRow({ inc, bordered }: { inc: IncidentRow; bordered: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const dates = inc.occurrences.map((o) => o.date.slice(0, 10)).sort();
  const first = dates[0];
  const latest = dates[dates.length - 1];
  return (
    <div style={{ borderBottom: bordered ? "1px solid var(--border-muted)" : "none" }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "120px 1fr 80px 110px",
          gap: 12,
          padding: "12px 14px",
          textAlign: "left",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          alignItems: "baseline",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)", textTransform: "capitalize" }}>
          {inc.type}
        </span>
        <Sparkline dates={dates} />
        <span className="mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
          × {inc.count}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color:
              inc.latest_status === "resolved"
                ? "var(--rep-trusted)"
                : inc.latest_status === "open" || inc.latest_status === "reported"
                  ? "var(--high)"
                  : "var(--fg-dim)",
            textAlign: "right",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {inc.latest_status ?? "—"}
        </span>
      </button>
      {expanded && (
        <div
          style={{
            padding: "8px 14px 14px",
            background: "var(--bg)",
            borderTop: "1px solid var(--border-muted)",
          }}
        >
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 6 }}>
            first {first} · latest {latest}
          </div>
          {inc.occurrences.map((o, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "100px 1fr",
                gap: 12,
                fontSize: 11,
                padding: "4px 0",
              }}
            >
              <span className="mono" style={{ color: "var(--fg-dim)" }}>
                {o.date.slice(0, 10)}
              </span>
              <span style={{ color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.source_title}>
                {o.source_title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Sparkline({ dates }: { dates: string[] }) {
  if (dates.length === 0) return <div />;
  const ts = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const min = ts[0];
  const max = ts[ts.length - 1];
  const span = Math.max(1, max - min);
  return (
    <div
      style={{
        position: "relative",
        height: 18,
        background: "var(--bg)",
        borderRadius: 4,
        border: "1px solid var(--border-muted)",
      }}
    >
      {ts.map((t, i) => {
        const pct = ((t - min) / span) * 100;
        return (
          <span
            key={i}
            style={{
              position: "absolute",
              left: `${pct}%`,
              top: 3,
              width: 4,
              height: 12,
              borderRadius: 2,
              background: "var(--brand)",
              transform: "translateX(-2px)",
            }}
          />
        );
      })}
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Avatar({ name, type, size = 56 }: { name: string; type: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (hash * 13) % 360;
  const isPlace = type === "unit" || type === "building" || type === "weg";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: isPlace ? 12 : 8,
        background: `oklch(0.85 0.04 ${hue})`,
        color: `oklch(0.32 0.06 ${hue})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.32,
        fontWeight: 500,
        letterSpacing: "-0.02em",
        flexShrink: 0,
        border: "1px solid var(--border)",
      }}
    >
      {isPlace ? <PlaceGlyph /> : initials}
    </div>
  );
}

function PlaceGlyph() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <path d="M6 26V12l10-6 10 6v14" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 26v-7h8v7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function QueryStatsChip({ stats }: { stats: QueryStats }) {
  const trendIcon = stats.up > stats.down ? "▲" : stats.down > stats.up ? "▼" : "·";
  const trendColor =
    stats.up > stats.down
      ? "var(--brand)"
      : stats.down > stats.up
        ? "var(--rep-avoid)"
        : "var(--fg-dim)";
  return (
    <span
      title="Agent query frequency for this entity. Source priors of the cited documents are adjusted by user feedback."
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 10px",
        borderRadius: 6,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "var(--fg-muted)",
      }}
    >
      <span style={{ color: "var(--fg-dim)" }}>asked</span>
      <span style={{ color: "var(--fg)" }}>{stats.week}× / 7d</span>
      <span style={{ color: "var(--fg-dim)" }}>·</span>
      <span style={{ color: "var(--fg-muted)" }}>{stats.month}× / 30d</span>
      {(stats.up > 0 || stats.down > 0) && (
        <>
          <span style={{ color: "var(--fg-dim)" }}>·</span>
          <span style={{ color: trendColor }}>
            {trendIcon} {stats.up}↑ {stats.down}↓
          </span>
        </>
      )}
    </span>
  );
}

function ReputationLine({
  reputation,
  verbose,
}: {
  reputation: Reputation;
  verbose?: boolean;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 10px",
        borderRadius: 6,
        background:
          reputation.band === "trusted"
            ? "var(--brand-wash)"
            : reputation.band === "avoid"
              ? "rgba(153,27,27,0.07)"
              : "var(--bg-elevated)",
        border: "1px solid var(--border-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: BAND_COLOR[reputation.band] ?? "var(--fg-muted)",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: BAND_COLOR[reputation.band] ?? "var(--fg-dim)",
        }}
      />
      <span style={{ textTransform: "lowercase" }}>{reputation.band}</span>
      <span style={{ opacity: 0.7 }}>· {reputation.score.toFixed(2)}</span>
      {verbose && reputation.incidents_open > 0 && (
        <span style={{ opacity: 0.7 }}>· {reputation.incidents_open} open</span>
      )}
      {verbose && reputation.mahnung_count > 0 && (
        <span style={{ opacity: 0.7 }}>· {reputation.mahnung_count} mahnung</span>
      )}
    </div>
  );
}

function KVRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, padding: "4px 0", fontSize: 12 }}>
      <span className="mono" style={{ color: "var(--fg-dim)" }}>{k}</span>
      <span className={mono ? "mono" : ""} style={{ color: "var(--fg)" }}>
        {v}
      </span>
    </div>
  );
}

function MetaRows({ meta }: { meta: Record<string, unknown> }) {
  return (
    <>
      {Object.entries(meta).slice(0, 6).map(([k, v]) => {
        if (v === null || v === undefined || v === "") return null;
        const display =
          typeof v === "string" || typeof v === "number" || typeof v === "boolean"
            ? String(v)
            : JSON.stringify(v);
        return <KVRow key={k} k={prettyKey(k)} v={display} />;
      })}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3
        className="mono"
        style={{
          margin: "0 0 10px",
          fontSize: 11,
          color: "var(--fg-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function prettyType(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function prettyKey(k: string): string {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isMonoKey(k: string): boolean {
  return /email|phone|iban|tax|id$|number/i.test(k);
}
