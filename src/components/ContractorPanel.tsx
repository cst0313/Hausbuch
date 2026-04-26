// path: src/components/ContractorPanel.tsx
"use client";

import { useEffect, useState } from "react";

type Job = {
  source_id: string;
  source_title: string;
  date: string;
  type: string | null;
  status: string | null;
  unit: string | null;
};

export type Availability = {
  open_jobs: number;
  earliest_available: string;
  earliest_label: string;
  typical_turnaround_days: number | null;
  last_completed_at: string | null;
};

export type Trace = {
  source_id: string;
  source_title: string;
  source_kind: string;
  ingested_at: string;
  fact_count: number;
  predicates: string[];
  spans: string[];
  excerpt: string;
};

export type Contractor = {
  id: string;
  name: string;
  trade: string | null;
  ansprechpartner: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  cala_verified: boolean;
  reputation: {
    score: number;
    band: "trusted" | "neutral" | "avoid";
    incidents_open: number;
    incidents_total: number;
    mahnung_count: number;
    last_incident_at: string | null;
  };
  jobs: Job[];
  availability: Availability;
  traces?: Trace[];
};

const BAND_COLOR: Record<string, string> = {
  trusted: "var(--rep-trusted)",
  neutral: "var(--rep-neutral)",
  avoid: "var(--rep-avoid)",
};

// ── Picker (modal opened from Stream "Dispatch handyman") ────────────────────

export function ContractorPicker({
  open,
  trade,
  unit,
  onClose,
  onDispatch,
  onOpenProfile,
}: {
  open: boolean;
  trade: string;
  unit?: string;
  onClose: () => void;
  onDispatch: (c: Contractor) => void;
  onOpenProfile: (c: Contractor) => void;
}) {
  const [list, setList] = useState<Contractor[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/contractors?trade=${encodeURIComponent(trade)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setList(d.contractors ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, trade]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const top = list[0];
  const avoided = list.find((c, i) => i > 0 && c.reputation.band === "avoid");

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 250,
        background: "rgba(28,26,22,0.42)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "6vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 920,
          maxWidth: "94%",
          background: "var(--bg)",
          borderRadius: 12,
          border: "1px solid var(--border-muted)",
          boxShadow: "0 24px 80px rgba(28,26,22,0.20)",
          overflow: "hidden",
          maxHeight: "84vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.02em", margin: 0 }}>
                Dispatch handyman {trade && <span style={{ color: "var(--fg-muted)" }}>· {prettyTrade(trade)}</span>}
              </h2>
              <p
                className="mono"
                style={{
                  margin: "4px 0 0",
                  fontSize: 11,
                  color: "var(--fg-muted)",
                }}
              >
                {unit ? `for ${unit} · ` : ""}ordered by reputation
              </p>
            </div>
            <button
              onClick={onClose}
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

          {/* Routing justification */}
          {top && avoided && top.reputation.score > avoided.reputation.score + 0.15 && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                background: "var(--brand-wash)",
                borderRadius: 6,
                fontSize: 12,
                color: "var(--fg)",
                display: "flex",
                gap: 8,
              }}
            >
              <span
                className="mono"
                style={{
                  color: "var(--brand)",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  flexShrink: 0,
                  paddingTop: 2,
                }}
              >
                routing
              </span>
              <span>
                Picked <strong>{top.name}</strong> ({starsLabel(top.reputation.score)})
                {" "}over <strong>{avoided.name}</strong> ({starsLabel(avoided.reputation.score)})
                <span className="serif-italic" style={{ color: "var(--fg-muted)" }}>
                  {" "}— faster availability and a longer track record.
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Cards */}
        <div
          style={{
            padding: 18,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
            overflow: "auto",
          }}
        >
          {loading && (
            <p className="mono" style={{ fontSize: 12, color: "var(--fg-dim)" }}>
              Loading contractors…
            </p>
          )}
          {!loading && list.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--fg-muted)" }}>
              No contractors match this trade.
            </p>
          )}
          {list.map((c, i) => (
            <ContractorCard
              key={c.id}
              c={c}
              primary={i === 0}
              onDispatch={() => onDispatch(c)}
              onOpenProfile={() => onOpenProfile(c)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ContractorCard({
  c,
  primary,
  onDispatch,
  onOpenProfile,
}: {
  c: Contractor;
  primary: boolean;
  onDispatch: () => void;
  onOpenProfile: () => void;
}) {
  return (
    <div
      style={{
        padding: 14,
        background: "var(--bg-elevated)",
        border: "1px solid " + (primary ? "var(--brand-line)" : "var(--border)"),
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", gap: 10 }}>
        <PhotoPlaceholder name={c.name} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={onOpenProfile}
            style={{
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "-0.01em",
              color: "var(--fg)",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "inherit",
            }}
            title="Open profile"
          >
            {c.name}
          </button>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-muted)", marginTop: 2 }}>
            {c.trade ?? "—"}
          </div>
          {c.cala_verified && (
            <div
              className="mono"
              style={{
                marginTop: 4,
                fontSize: 10,
                color: "var(--brand)",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                <path d="M2 6.5L4.8 9L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              Cala verified
            </div>
          )}
        </div>
      </div>

      <StarRating reputation={c.reputation} jobs={c.jobs.length} />

      <div className="mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", lineHeight: 1.5 }}>
        {c.email ?? "—"}
        {c.phone && <><br />{c.phone}</>}
      </div>

      <div>
        <div
          className="mono"
          style={{
            fontSize: 9,
            color: "var(--fg-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 4,
          }}
        >
          Availability
        </div>
        <AvailabilityBlock availability={c.availability} compact />
      </div>

      <button
        onClick={onDispatch}
        style={{
          padding: "8px 12px",
          background: primary ? "var(--brand)" : "var(--bg)",
          color: primary ? "white" : "var(--fg)",
          border: "1px solid " + (primary ? "var(--brand)" : "var(--border-muted)"),
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          cursor: "pointer",
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        Dispatch →
      </button>
    </div>
  );
}

function AvailabilityBlock({
  availability,
  compact,
}: {
  availability: Availability;
  compact?: boolean;
}) {
  const free = availability.open_jobs === 0;
  const dotColor = free
    ? "var(--rep-trusted)"
    : availability.open_jobs <= 2
      ? "var(--rep-neutral)"
      : "var(--rep-avoid)";

  if (compact) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg)" }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: dotColor,
              flexShrink: 0,
            }}
          />
          <span>
            Earliest:{" "}
            <span className="mono" style={{ color: "var(--brand)" }}>
              {availability.earliest_label}
            </span>
          </span>
        </div>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)" }}>
          {availability.open_jobs === 0
            ? "no open jobs"
            : `${availability.open_jobs} open ${availability.open_jobs === 1 ? "job" : "jobs"}`}
          {availability.typical_turnaround_days !== null && (
            <> · ~{availability.typical_turnaround_days}d turnaround</>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "14px 16px",
        background: "var(--bg-elevated)",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        rowGap: 12,
        columnGap: 16,
      }}
    >
      <AvailabilityRow
        label="Earliest available"
        value={availability.earliest_label}
        sub={availability.earliest_available}
        accent
      />
      <AvailabilityRow
        label="Open jobs"
        value={String(availability.open_jobs)}
        sub={availability.open_jobs === 0 ? "fully free" : "in queue"}
        dot={dotColor}
      />
      <AvailabilityRow
        label="Typical turnaround"
        value={
          availability.typical_turnaround_days !== null
            ? `~${availability.typical_turnaround_days}d`
            : "—"
        }
        sub={availability.typical_turnaround_days !== null ? "rolling, last 90d" : "no resolved jobs"}
      />
      <AvailabilityRow
        label="Last completed"
        value={availability.last_completed_at?.slice(0, 10) ?? "—"}
        sub={availability.last_completed_at ? relativeDays(availability.last_completed_at) : "no record"}
      />
    </div>
  );
}

function AvailabilityRow({
  label,
  value,
  sub,
  accent,
  dot,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  dot?: string;
}) {
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 9,
          color: "var(--fg-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 4,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {dot && (
          <span
            style={{ width: 6, height: 6, borderRadius: 999, background: dot, flexShrink: 0 }}
          />
        )}
        {label}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: accent ? "var(--brand)" : "var(--fg)",
        }}
      >
        {value}
      </div>
      {sub && (
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function relativeDays(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── Profile panel (slide-in) ─────────────────────────────────────────────────

export function ContractorProfilePanel({
  open,
  contractorId,
  onClose,
  onOpenEntity,
}: {
  open: boolean;
  contractorId: string | null;
  onClose: () => void;
  /** Optional: when set, clicking a unit chip in Service history opens that
   *  unit/building's profile via the dashboard's central panel router. */
  onOpenEntity?: (id: string) => void;
}) {
  const [c, setC] = useState<Contractor | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !contractorId) return;
    let cancelled = false;
    setLoading(true);
    setC(null);
    fetch(`/api/contractors?id=${encodeURIComponent(contractorId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setC(d.contractor ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, contractorId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open && !contractorId) return null;

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
          <div>
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
              Contractor profile
            </p>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em" }}>
              {c?.name ?? (loading ? "Loading…" : "—")}
            </h2>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {contractorId && (
              <a
                href={`/api/report/entity/${encodeURIComponent(contractorId)}?download=1`}
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
              ▸▸▸ loading…
            </p>
          )}
          {!loading && c && (
            <>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 24 }}>
                <PhotoPlaceholder name={c.name} size={88} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <KVRow k="Trade" v={c.trade ?? "—"} />
                  <KVRow k="Contact person" v={c.ansprechpartner ?? "—"} />
                  <KVRow k="Email" v={c.email ?? "—"} mono />
                  <KVRow k="Phone" v={c.phone ?? "—"} mono />
                  <KVRow k="Address" v={c.address ?? "—"} />
                  {c.cala_verified && (
                    <div style={{ marginTop: 8 }}>
                      <span
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: "var(--brand)",
                          background: "var(--brand-wash)",
                          padding: "2px 7px",
                          borderRadius: 4,
                        }}
                      >
                        ✓ Cala verified
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <Section title="Track record">
                <StarRating reputation={c.reputation} jobs={c.jobs.length} />
                <p style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 10 }}>
                  Last contact:{" "}
                  <span className="mono">
                    {c.reputation.last_incident_at?.slice(0, 10) ?? "—"}
                  </span>
                  {" · "}
                  {c.reputation.incidents_total} job
                  {c.reputation.incidents_total === 1 ? "" : "s"} on record
                </p>
              </Section>

              <Section title="Availability">
                <AvailabilityBlock availability={c.availability} />
              </Section>

              <Section title={`Service history · ${c.jobs.length} job${c.jobs.length === 1 ? "" : "s"}`}>
                <ServiceHistory jobs={c.jobs} onOpenEntity={onOpenEntity} />
              </Section>

              {(c.traces?.length ?? 0) > 0 && (
                <Section
                  title={`Where this contractor came from · ${c.traces!.length} source${c.traces!.length === 1 ? "" : "s"}`}
                >
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--fg-muted)",
                      margin: "0 0 10px",
                      fontStyle: "italic",
                      fontFamily: "var(--font-serif)",
                    }}
                  >
                    Every fact about {c.name} is grounded in one of these documents. Click a row to see the source text with the extracted spans highlighted in place.
                  </p>
                  <TraceList traces={c.traces!} />
                </Section>
              )}
            </>
          )}
          {!loading && !c && (
            <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>Contractor not found.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function PhotoPlaceholder({ name, size = 48 }: { name: string; size?: number }) {
  // Generate stable initials + hue from name so the demo looks real
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue = (hash * 13) % 360;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: `oklch(0.85 0.04 ${hue})`,
        color: `oklch(0.32 0.06 ${hue})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.35,
        fontWeight: 500,
        letterSpacing: "-0.02em",
        flexShrink: 0,
        border: "1px solid var(--border)",
      }}
    >
      {initials}
    </div>
  );
}

function ReputationLine({
  reputation,
  verbose,
}: {
  reputation: Contractor["reputation"];
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

function starsLabel(score: number): string {
  const stars = Math.round(score * 5 * 2) / 2;
  return `${stars.toFixed(1)}★`;
}

function StarRating({
  reputation,
  jobs,
}: {
  reputation: Contractor["reputation"];
  jobs: number;
}) {
  // Score [0..1] → 0..5 stars at half-star precision.
  const stars = Math.round(reputation.score * 5 * 2) / 2;
  const full = Math.floor(stars);
  const half = stars - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
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
        {stars.toFixed(1)} / 5
        {jobs > 0 && (
          <>
            {" · "}
            {jobs} recent job{jobs === 1 ? "" : "s"}
          </>
        )}
      </span>
    </div>
  );
}

function Star({ fill }: { fill: "full" | "half" | "empty" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="cp-halfstar" x1="0" x2="1" y1="0" y2="0">
          <stop offset="50%" stopColor="currentColor" />
          <stop offset="50%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path
        d="M8 1.5l1.96 4.27 4.54.46-3.4 3.05.96 4.5L8 11.5l-4.06 2.27.96-4.5L1.5 6.23l4.54-.46L8 1.5z"
        fill={fill === "full" ? "currentColor" : fill === "half" ? "url(#cp-halfstar)" : "transparent"}
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ServiceHistory({
  jobs,
  onOpenEntity,
}: {
  jobs: Job[];
  onOpenEntity?: (id: string) => void;
}) {
  if (jobs.length === 0) {
    return (
      <p style={{ fontSize: 12, color: "var(--fg-dim)", margin: 0 }}>
        No service history yet — first job will land here once dispatched.
      </p>
    );
  }
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-elevated)",
        overflow: "hidden",
      }}
    >
      {jobs.map((j, i) => {
        // Convert "WE 32" / "EH-018" / "Haus 12" → an entity id we can open.
        const unitId = unitToEntityId(j.unit);
        return (
          <div
            key={j.source_id}
            style={{
              display: "grid",
              gridTemplateColumns: "92px 86px 1fr 84px",
              gap: 12,
              padding: "10px 14px",
              fontSize: 12,
              alignItems: "baseline",
              borderBottom:
                i < jobs.length - 1 ? "1px solid var(--border-muted)" : "none",
            }}
          >
            <span className="mono" style={{ color: "var(--fg-dim)", fontSize: 10 }}>
              {j.date.slice(0, 10)}
            </span>
            {j.unit ? (
              <button
                onClick={() => unitId && onOpenEntity?.(unitId)}
                disabled={!unitId || !onOpenEntity}
                title={
                  unitId && onOpenEntity
                    ? `Open ${j.unit} profile`
                    : `Unit anchor: ${j.unit}`
                }
                className="mono"
                style={{
                  color: "var(--brand)",
                  fontSize: 10.5,
                  padding: "2px 8px",
                  borderRadius: 3,
                  background: "var(--brand-wash)",
                  border: "1px solid var(--brand-line)",
                  textAlign: "center",
                  whiteSpace: "nowrap",
                  cursor: unitId && onOpenEntity ? "pointer" : "default",
                  fontFamily: "inherit",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                }}
              >
                {j.unit}
                {unitId && onOpenEntity && <span style={{ opacity: 0.7 }}>→</span>}
              </button>
            ) : (
              <span
                className="mono"
                style={{
                  color: "var(--fg-dim)",
                  fontSize: 10.5,
                  textAlign: "center",
                }}
              >
                —
              </span>
            )}
            <span
              style={{
                color: "var(--fg)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={j.source_title}
            >
              {j.source_title.replace(/^(re|fwd|aw|wg):\s*/i, "")}
            </span>
            <span
              className="mono"
              style={{
                color: "var(--fg-dim)",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                textAlign: "right",
              }}
            >
              {j.type ?? "general"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TraceList({ traces }: { traces: Trace[] }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-elevated)",
        overflow: "hidden",
      }}
    >
      {traces.map((t, i) => (
        <TraceRow key={t.source_id} trace={t} bordered={i < traces.length - 1} />
      ))}
    </div>
  );
}

function TraceRow({ trace, bordered }: { trace: Trace; bordered: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ borderBottom: bordered ? "1px solid var(--border-muted)" : "none" }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "100px 1fr 70px 26px",
          gap: 12,
          padding: "10px 14px",
          textAlign: "left",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          alignItems: "baseline",
        }}
      >
        <span className="mono" style={{ fontSize: 10, color: "var(--fg-dim)" }}>
          {trace.ingested_at.slice(0, 10)}
        </span>
        <span
          style={{
            fontSize: 12,
            color: "var(--fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={trace.source_title}
        >
          {trace.source_title.replace(/^(re|fwd|aw|wg):\s*/i, "")}
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10,
            color: "var(--brand)",
            textAlign: "right",
            background: "var(--brand-wash)",
            borderRadius: 3,
            padding: "1px 6px",
          }}
        >
          {trace.fact_count} fact{trace.fact_count === 1 ? "" : "s"}
        </span>
        <span
          className="mono"
          style={{ fontSize: 14, color: "var(--fg-dim)", textAlign: "center" }}
        >
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div
          style={{
            padding: "12px 14px 14px",
            background: "var(--bg)",
            borderTop: "1px solid var(--border-muted)",
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--fg-dim)",
              marginBottom: 6,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span>{trace.source_kind}</span>
            <span>·</span>
            <span>{trace.predicates.length} predicate{trace.predicates.length === 1 ? "" : "s"}:</span>
            {trace.predicates.slice(0, 6).map((p) => (
              <span
                key={p}
                style={{
                  color: "var(--brand)",
                  background: "var(--brand-wash)",
                  padding: "1px 6px",
                  borderRadius: 3,
                }}
              >
                {p}
              </span>
            ))}
          </div>
          <HighlightedExcerpt text={trace.excerpt} spans={trace.spans} />
        </div>
      )}
    </div>
  );
}

/** Walk text once, wrap longest-matching span in <mark>; greedy first-match. */
function HighlightedExcerpt({ text, spans }: { text: string; spans: string[] }) {
  if (!text) {
    return (
      <p style={{ fontSize: 11, color: "var(--fg-dim)", fontStyle: "italic" }}>
        Source text not stored.
      </p>
    );
  }
  const uniq = Array.from(new Set(spans.filter((s) => s && s.length >= 3))).sort(
    (a, b) => b.length - a.length,
  );
  type Seg = { text: string; hit: boolean };
  const segs: Seg[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let next: { idx: number; q: string } | null = null;
    for (const q of uniq) {
      const idx = text.indexOf(q, cursor);
      if (idx >= 0 && (!next || idx < next.idx)) {
        next = { idx, q };
        if (idx === cursor) break;
      }
    }
    if (!next) {
      segs.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (next.idx > cursor) segs.push({ text: text.slice(cursor, next.idx), hit: false });
    segs.push({ text: next.q, hit: true });
    cursor = next.idx + next.q.length;
  }
  return (
    <pre
      className="mono"
      style={{
        fontSize: 11,
        lineHeight: 1.55,
        color: "var(--fg-muted)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
        maxHeight: 280,
        overflow: "auto",
        padding: "10px 12px",
        background: "var(--bg-elevated)",
        borderRadius: 6,
        border: "1px solid var(--border-muted)",
      }}
    >
      {segs.map((s, i) =>
        s.hit ? (
          <mark
            key={i}
            style={{
              background: "rgba(245,200,102,0.55)",
              color: "var(--fg)",
              padding: "1px 3px",
              borderRadius: 3,
            }}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </pre>
  );
}

/** Map a human unit string to its entity id where the seed schema allows.
 *  "WE 32" → unit:EH-032 if the seed maps WE numbers to einheit ids; otherwise
 *  we can't resolve and the chip stays static. */
function unitToEntityId(unit: string | null): string | null {
  if (!unit) return null;
  const we = unit.match(/WE\s*(\d{1,3})/i);
  if (we) {
    const num = we[1].padStart(3, "0");
    return `unit:EH-${num}`;
  }
  const eh = unit.match(/EH-?(\d{2,4})/i);
  if (eh) return `unit:EH-${eh[1].padStart(3, "0")}`;
  const haus = unit.match(/Haus\s+(\d{1,3}\w?)/i);
  if (haus) return `building:HAUS-${haus[1].toUpperCase()}`;
  return null;
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

function prettyTrade(t: string): string {
  return t.replace(/_/g, " ");
}
