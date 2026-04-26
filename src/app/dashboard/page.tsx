// path: src/app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { useLocale } from "@/components/LocaleProvider";
import { CmdK } from "@/components/CmdK";
import type { Band } from "@/components/DashboardPrimitives";
import { StreamPanel, type StreamRec } from "@/components/StreamPanel";
import { prefetchIncident } from "@/lib/prefetch-incident";
import { UploadResultModal, type UploadResult } from "@/components/UploadPanel";
import { UploadReviewModal } from "@/components/UploadReviewModal";
import { ContractorPicker, ContractorProfilePanel, type Contractor } from "@/components/ContractorPanel";
import { EntityProfilePanel } from "@/components/EntityProfilePanel";
// AddEntityModal moved to /sandbox — the dashboard reflects the seeded
// hackathon corpus only; sandbox is where the user experiments.

// ── Types ────────────────────────────────────────────────────────────────────

type Recommendation = {
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
  email_chain?: Array<{ source_id: string; title: string; date: string }>;
  actions: Array<{ type: string; label: string; label_de: string }>;
  entity_reputation?: { score: number; band: Band; incidents_open: number; mahnung_count: number; related_units?: string[] };
  /** Operational issues that caused this rec, set on legal recs whose body
   *  cited Mängel. Used to label dispatched contractors with the actual
   *  root-cause type instead of the legal category. */
  root_causes?: Array<{ type: string; score: number; open_incident_count?: number }>;
  created_at: string;
  /** Override the auto-computed step (1..5) — used by demo items so the
   *  lifecycle bar shows progression instead of every row landing at 3. */
  forceStep?: 1 | 2 | 3 | 4 | 5;
  /** When forceStep is 4 (Sent), the substring shown next to the bar. */
  stepLabelOverride?: string;
};

type AuditAction = {
  id: string;
  ts: string;
  actor: string;
  action: string;
  entity: string | null;
  target: string | null;
};

const SEVERITY_ORDER: Array<Recommendation["severity"]> = ["critical", "high", "medium", "low"];
// Canonical 5-step lifecycle every recommendation moves through.
const STEP_NAMES = ["Received", "Reviewed", "Drafted", "Sent", "Resolved"];

const SEVERITY_KEY: Record<Recommendation["severity"], string> = {
  critical: "dash.severity.critical",
  high: "dash.severity.high",
  medium: "dash.severity.medium",
  low: "dash.severity.low",
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { locale, t } = useLocale();
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [activity, setActivity] = useState<AuditAction[]>([]);
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [streamRec, setStreamRec] = useState<Recommendation | null>(null);
  const [streamOpen, setStreamOpen] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTrade, setPickerTrade] = useState<string>("");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [entityProfileId, setEntityProfileId] = useState<string | null>(null);
  const [entityProfileOpen, setEntityProfileOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const openProfile = (id: string) => {
    setProfileId(id);
    setProfileOpen(true);
  };

  const openEntityProfile = (id: string) => {
    // Contractors get their dedicated panel; everything else uses the generic one.
    if (id.startsWith("contractor:")) {
      openProfile(id);
      return;
    }
    setEntityProfileId(id);
    setEntityProfileOpen(true);
  };

  const refresh = () => {
    // Fire both independently so the audit strip doesn't wait for the
    // recs cold path (9–10 s on a fresh server before the engine cache
    // warms). Each setter lights up its own surface as soon as it's ready.
    fetch("/api/recommendations")
      .then((r) => r.json())
      .then((d) => {
        setRecs(d.recommendations ?? []);
        try {
          sessionStorage.setItem("hausbuch:recs:v1", JSON.stringify(d.recommendations ?? []));
        } catch {
          /* quota / disabled */
        }
      })
      .catch(() => {});
    fetch("/api/audit?limit=200")
      .then((r) => r.json())
      .then((d) => setActivity(d.actions ?? []))
      .catch(() => {});
  };

  const openStream = (rec: Recommendation) => {
    setStreamRec(rec);
    setStreamOpen(true);
  };
  const closeStream = () => {
    setStreamOpen(false);
    // Keep streamRec around briefly so the close animation doesn't show empty content.
    setTimeout(() => setStreamRec(null), 250);
  };

  // Cmd+K + slash global
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;

    // 1. Hydrate recs from sessionStorage if available — re-entering the
    //    /dashboard tab paints the rec list instantly while a refresh
    //    runs in the background. The /api/recommendations cold path is
    //    ~10 s on first hit because the engine has to rebuild from facts.
    let hydratedFromCache = false;
    try {
      const cached = sessionStorage.getItem("hausbuch:recs:v1");
      if (cached) {
        const parsed = JSON.parse(cached) as Recommendation[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRecs(parsed);
          setLoading(false);
          hydratedFromCache = true;
        }
      }
    } catch {
      /* sessionStorage disabled — fall through */
    }

    // 2. Fire the two fetches independently so the audit strip doesn't
    //    block on the recs cold path. setLoading(false) the moment EITHER
    //    arrives so the user sees something happening on a cold server.
    fetch("/api/recommendations")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const recs = d.recommendations ?? [];
        setRecs(recs);
        setLoading(false);
        try {
          sessionStorage.setItem("hausbuch:recs:v1", JSON.stringify(recs));
        } catch {
          /* quota / disabled — silently skip */
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    fetch("/api/audit?limit=200")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setActivity(d.actions ?? []);
        if (!hydratedFromCache) setLoading(false);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  // Aggregate stats for the strip
  const stats = useMemo(() => {
    const open = recs.filter((r) => !resolvedIds.has(r.id)).length;
    const critical = recs.filter(
      (r) => r.severity === "critical" && !resolvedIds.has(r.id),
    ).length;
    const drafts = recs.filter((r) => r.actions.some((a) => a.type === "draft_email")).length;
    const resolved = activity.filter((a) =>
      a.action.includes("resolve") || a.action.includes("approve") || a.action.includes("send"),
    ).length + resolvedIds.size;
    const buildings = 50; // fixed for now
    return { open, critical, drafts, resolved, buildings };
  }, [recs, activity, resolvedIds]);

  // dayStr / greeting depend on the user's local clock + timezone — defer to
  // an effect so the initial server-rendered HTML matches the client. Server
  // would say "Saturday 26 April" in UTC; client could say "Sunday" depending
  // on TZ — that mismatch is what triggers React's hydration warning.
  const dateLocale = locale === "de" ? "de-DE" : "en-GB";
  const [todayStamp, setTodayStamp] = useState<{ dayStr: string; hour: number } | null>(null);
  useEffect(() => {
    const now = new Date();
    setTodayStamp({
      dayStr: now.toLocaleDateString(dateLocale, {
        weekday: "long",
        day: "numeric",
        month: "long",
      }),
      hour: now.getHours(),
    });
  }, [dateLocale]);
  const dayStr = todayStamp?.dayStr ?? "";

  // Interleave by category within each severity tier so the manager sees a
  // diverse mix at the top, not 24 Mietminderungs in a row. Also drops
  // anything the user has already resolved this session.
  //
  // Visibility cap: triage view, not a backlog dump. The engine surfaces
  // ~170 open recs across the seeded corpus — that's noise. Take the top
  // VISIBLE_LIMIT severity-ordered with critical fully kept and the
  // remaining slots filled high → medium → low. The hidden tail count is
  // surfaced as a footer link so the user knows the queue isn't a lie.
  const VISIBLE_LIMIT = 15;
  const allOpen = recs.filter((r) => !resolvedIds.has(r.id));
  const ranked: Recommendation[] = [];
  for (const sev of SEVERITY_ORDER) {
    const tier = interleaveByCategory(allOpen.filter((r) => r.severity === sev));
    for (const r of tier) {
      if (ranked.length >= VISIBLE_LIMIT) break;
      ranked.push(r);
    }
    if (ranked.length >= VISIBLE_LIMIT) break;
  }
  const hiddenCount = allOpen.length - ranked.length;
  const groups = SEVERITY_ORDER
    .map((sev) => ({
      sev,
      items: ranked.filter((r) => r.severity === sev),
    }))
    .filter((g) => g.items.length > 0);

  // Greeting also depends on the client clock — fall back to "Hello" until
  // the effect populates todayStamp so SSR + hydrate render the same string.
  const greetingKey =
    todayStamp == null
      ? "dash.greeting.morning"
      : greetingKeyForHour(todayStamp.hour);
  const greeting = t(greetingKey);

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav
        onOpenSearch={() => setPaletteOpen(true)}
        rightSlot={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => setReviewOpen(true)}
              title="Drop a PDF, .eml, or .zip — review the extracted facts before they hit the database"
              style={{
                height: 36,
                padding: "0 14px",
                background: "var(--brand)",
                color: "white",
                border: "1px solid var(--brand)",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M8 11V3M5 6l3-3 3 3M3 12.5v.5a1 1 0 001 1h8a1 1 0 001-1v-.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Upload data
            </button>
          </div>
        }
      />

      {/* Editorial header */}
      <section style={{ maxWidth: 1480, margin: "0 auto", padding: "40px 48px 24px" }}>
        <p
          className="mono"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--fg-dim)",
            margin: "0 0 12px",
          }}
        >
          {dayStr}
        </p>
        <h1
          style={{
            fontSize: 38,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          {greeting}{" "}
          <span className="serif-italic" style={{ fontWeight: 400 }}>
            {numberWord(stats.open, locale)}{" "}
            {t(stats.open === 1 ? "dash.headline.thing.singular" : "dash.headline.thing.plural")}
          </span>{" "}
          {t(stats.open === 1 ? "dash.headline.needs.singular" : "dash.headline.needs.plural")}{" "}
          {t("dash.headline.tail")}
        </h1>
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 15,
            color: "var(--fg-muted)",
            maxWidth: 640,
            lineHeight: 1.55,
          }}
        >
          {t("dash.lede.before_kbd")}{" "}
          <span
            className="mono"
            style={{
              background: "var(--bg-hover)",
              padding: "1px 6px",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            ⌘K
          </span>{" "}
          {t("dash.lede.after_kbd")} {stats.buildings} {t("dash.lede.buildings_suffix")}
        </p>

        {/* Stat strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            marginTop: 28,
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Stat
            label={t("dash.kpi.open_recs")}
            value={stats.open}
            delta={t("dash.kpi.crit_below_critical")
              .replace("{n}", String(stats.critical))
              .replace("{m}", String(stats.open - stats.critical))}
          />
          <Stat
            label={t("dash.kpi.critical")}
            value={stats.critical}
            valueClass="crit"
            delta={stats.critical > 0 ? t("dash.kpi.respond_today") : t("dash.kpi.all_clear")}
          />
          <Stat
            label={t("dash.kpi.drafts")}
            value={stats.drafts}
            delta={`of ${stats.open} open · ${
              stats.open - stats.drafts > 0
                ? `${stats.open - stats.drafts} need contact info`
                : t("dash.kpi.review_under_30s")
            }`}
          />
          <Stat
            label={t("dash.kpi.resolved")}
            value={stats.resolved}
            delta={
              resolvedIds.size > 0
                ? `${resolvedIds.size} this session · ${stats.resolved - resolvedIds.size} from audit log`
                : `${stats.resolved} from audit log`
            }
            isLast
          />
        </div>

        {/* Live activity strip — derived from the same audit log /audit used to render */}
        <ActivityStrip activity={activity} onOpenEntity={openEntityProfile} />
      </section>

      {/* Recommendation list */}
      <section style={{ maxWidth: 1480, margin: "0 auto", padding: "8px 48px 80px" }}>
        {/*
          Render a skeleton instead of a blank "Loading…" line. The recs
          cold path is ~10 s on a fresh server while the engine cache
          warms; the skeleton keeps the page visually alive so the user
          sees the dashboard's shape immediately, with placeholder rows
          fading into the real data when the fetch resolves.
        */}
        {loading && <RecListSkeleton />}
        {!loading && groups.length === 0 && (
          <p style={{ color: "var(--fg-dim)", padding: "20px 0" }}>{t("dash.section.empty")}</p>
        )}
        {groups.map((g) => (
          <div key={g.sev}>
            <SeverityHeader sev={g.sev} count={g.items.length} t={t} />
            {g.items.map((rec) => (
              <RecRow
                key={rec.id}
                rec={rec}
                resolved={resolvedIds.has(rec.id)}
                sent={sentIds.has(rec.id)}
                locale={locale}
                t={t}
                onOpen={() => openStream(rec)}
              />
            ))}
          </div>
        ))}
        {/*
          Hidden-tail hint. We cap the dashboard at 15 visible recs because
          a 170-row backlog reads as noise on a triage view. The number
          here is the truth — the rest are still in the engine, surfaced
          via the agent (⌘K), /context, or /audit.
        */}
        {!loading && hiddenCount > 0 && (
          <div
            className="mono"
            style={{
              marginTop: 24,
              padding: "16px 20px",
              borderTop: "1px solid var(--border-muted)",
              fontSize: 12,
              color: "var(--fg-dim)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <span>
              + {hiddenCount} more open recs not shown — triage focuses on the top 15 by severity.
            </span>
            <span style={{ color: "var(--fg-muted)" }}>
              Ask the agent (⌘K) or open <a href="/audit" style={{ color: "var(--brand)" }}>/audit</a> for the full queue.
            </span>
          </div>
        )}
      </section>

      <CmdK
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenEntity={(id) => {
          setPaletteOpen(false);
          openEntityProfile(id);
        }}
      />

      <StreamPanel
        rec={streamRec as StreamRec | null}
        open={streamOpen}
        locale={locale}
        onClose={closeStream}
        onOpenEntity={(id) => {
          closeStream();
          openEntityProfile(id);
        }}
        resolved={streamRec ? resolvedIds.has(streamRec.id) : false}
        sent={streamRec ? sentIds.has(streamRec.id) : false}
        onResolve={() => {
          if (!streamRec) return;
          // Optimistic: hide the row immediately
          setResolvedIds((s) => new Set([...s, streamRec.id]));
          // Persist: write incident.status=resolved so the audit log captures it
          // and the recommendation engine drops the rec on next refresh.
          fetch("/api/correct", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entity: streamRec.entity_id,
              predicate: "incident.status",
              value: "resolved",
              previous_value: "reported",
              note: `Manager marked "${streamRec.title}" resolved.`,
            }),
          }).catch(() => {});
        }}
        onSend={() => {
          if (streamRec) setSentIds((s) => new Set([...s, streamRec.id]));
        }}
        onDispatch={() => {
          // Map category → trade keyword for the picker
          const cat = streamRec?.category ?? "";
          const trade =
            cat.includes("water") ? "water_damage" :
            cat.includes("heat") ? "heating" :
            cat.includes("lock") || cat.includes("door") ? "lock_issue" :
            cat.includes("mold") ? "mold" :
            "water_damage";
          setPickerTrade(trade);
          setPickerOpen(true);
        }}
      />

      <ContractorPicker
        open={pickerOpen}
        trade={pickerTrade}
        unit={streamRec?.entity_name}
        onClose={() => setPickerOpen(false)}
        onDispatch={(c: Contractor) => {
          setPickerOpen(false);
          // Write the dispatch as a durable fact so the next status-update
          // draft can say "we have already contacted <contractor>" rather
          // than the generic "we are reviewing the matter". /api/dispatch
          // writes dispatch.contractor + incident.status=dispatched.
          // Compute the actual incident type for the dispatch source label.
          // For incident.* recs the category strips to the type directly.
          // For legal.* recs (Mietminderung / Kündigung) the underlying
          // type comes from root_causes — falling back to pickerTrade
          // which the UI already routed to a specific contractor branche.
          const dispatchType =
            streamRec?.category?.startsWith("incident.")
              ? streamRec.category.replace(/^incident\./, "")
              : streamRec?.root_causes?.[0]?.type ?? pickerTrade ?? undefined;
          fetch("/api/dispatch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entity_id: streamRec?.entity_id ?? "weg:immanuelkirchstr-26",
              contractor_id: c.id,
              contractor_name: c.name,
              incident_type: dispatchType,
              note: `Manager dispatched ${c.name} for ${streamRec?.title ?? "open issue"} (reputation ${c.reputation.score.toFixed(2)} ${c.reputation.band}).`,
            }),
          })
            .then(() => refresh())
            .catch(() => {});
        }}
        onOpenProfile={(c: Contractor) => {
          setPickerOpen(false);
          openProfile(c.id);
        }}
      />

      <ContractorProfilePanel
        open={profileOpen}
        contractorId={profileId}
        onClose={() => {
          setProfileOpen(false);
          setTimeout(() => setProfileId(null), 240);
        }}
        onOpenEntity={(id) => {
          setProfileOpen(false);
          setTimeout(() => {
            setProfileId(null);
            openEntityProfile(id);
          }, 240);
        }}
      />

      <EntityProfilePanel
        open={entityProfileOpen}
        entityId={entityProfileId}
        onClose={() => {
          setEntityProfileOpen(false);
          setTimeout(() => setEntityProfileId(null), 240);
        }}
        onOpenEntity={(id) => {
          // Cross-link from inside the panel — swap the entity in place.
          if (id.startsWith("contractor:")) {
            setEntityProfileOpen(false);
            setTimeout(() => {
              setEntityProfileId(null);
              openProfile(id);
            }, 240);
            return;
          }
          setEntityProfileId(id);
        }}
        onOpenCase={(rec) => {
          // The user clicked an open-case card on a tenant profile.
          // Close the profile and route to the existing StreamPanel,
          // which shows email_chain + action ladder + dispatch flow.
          setEntityProfileOpen(false);
          setTimeout(() => {
            setEntityProfileId(null);
            // Resolve the live rec from local state if we have it (so
            // the StreamPanel sees the same object reference the
            // dashboard does); fallback to the rec from the profile.
            const live = recs.find((r) => r.id === rec.id);
            openStream((live ?? rec) as Recommendation);
          }, 240);
        }}
      />

      <UploadResultModal
        result={uploadResult}
        onClose={() => setUploadResult(null)}
        onInspect={(entityId) => {
          // Find a recommendation tied to this entity, open its stream
          const match = recs.find((r) => r.entity_id === entityId);
          if (match) {
            setUploadResult(null);
            openStream(match);
          }
        }}
      />

      <UploadReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onCommitted={() => {
          refresh();
        }}
      />
    </div>
  );
}

// ── Activity strip (audit log integrated into dashboard) ────────────────────

const ACTOR_COLOR: Record<string, string> = {
  user: "var(--brand)",
  ingest: "#0c4a6e",
  gemini: "#7c3aed",
  tavily: "#b45309",
  cala: "#1d4ed8",
  gradium: "#0891b2",
  reconciler: "#78716c",
  aikido: "#be185d",
  system: "#44403c",
};

function ActivityStrip({
  activity,
  onOpenEntity,
}: {
  activity: AuditAction[];
  onOpenEntity: (id: string) => void;
}) {
  if (activity.length === 0) return null;
  // Filter to actions worth showing: skip pure metric pings and the noisier
  // internal events. Cap at 6 for the inline strip.
  const SHOW = activity
    .filter((a) => !a.action.startsWith("relevance.") && !a.action.startsWith("metric."))
    .slice(0, 6);
  if (SHOW.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 0",
        borderBottom: "1px solid var(--border-muted)",
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--fg-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          flexShrink: 0,
        }}
      >
        Live
      </span>
      <div
        style={{
          display: "flex",
          gap: 18,
          flex: 1,
          minWidth: 0,
          overflowX: "auto",
          // Hide the scrollbar — the strip is meant to feel lightweight; users
          // who want the full log click the link to the right.
          scrollbarWidth: "none",
        }}
      >
        {SHOW.map((a) => {
          const color = ACTOR_COLOR[a.actor] ?? "var(--fg-muted)";
          const human = humanizeAction(a);
          const clickable = !!a.entity && /^(tenant|owner|unit|building|weg|contractor):/.test(a.entity);
          return (
            <button
              key={a.id}
              onClick={() => clickable && a.entity && onOpenEntity(a.entity)}
              disabled={!clickable}
              title={`${a.action} · ${a.entity ?? ""}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11.5,
                color: "var(--fg-muted)",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: clickable ? "pointer" : "default",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: color,
                  flexShrink: 0,
                }}
              />
              <span className="mono" style={{ color, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.04 }}>
                {a.actor}
              </span>
              <span>{human}</span>
              <span
                className="mono"
                suppressHydrationWarning
                style={{ color: "var(--fg-dim)", fontSize: 10 }}
              >
                {relTime(a.ts)}
              </span>
            </button>
          );
        })}
      </div>
      <a
        href="/audit"
        style={{
          flexShrink: 0,
          fontSize: 11,
          color: "var(--brand)",
          textDecoration: "none",
          fontFamily: "var(--font-mono)",
          paddingLeft: 14,
          marginLeft: 2,
          borderLeft: "1px solid var(--border-muted)",
          whiteSpace: "nowrap",
        }}
      >
        full log →
      </a>
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  "source.ingest": "ingested source",
  "voice.transcribe": "transcribed voice",
  "voice.transcribe.failed": "voice transcription failed",
  "llm.compose": "composed answer",
  "llm.draft": "drafted email",
  "tavily.lookup": "fetched live data",
  "cala.verify": "verified entity",
  "entity.create": "added entity",
  "fact.correct": "corrected fact",
  "fact.revoke": "revoked fact",
  "approve": "approved proposal",
  "reject": "rejected proposal",
};

function humanizeAction(a: AuditAction): string {
  const base = ACTION_LABEL[a.action] ?? a.action.replace(/\./g, " ");
  if (a.entity) {
    const [, name] = a.entity.split(":");
    if (name) return `${base} · ${name}`;
  }
  return base;
}

function relTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ── Stat ─────────────────────────────────────────────────────────────────────

/**
 * Pulsing placeholder for the rec list. Three severity sections, four
 * faux rows each. Matches the real rows' grid + typography density so
 * the page doesn't reflow when the data arrives.
 */
function RecListSkeleton() {
  const sections: Array<{ tone: string; rows: number }> = [
    { tone: "var(--severity-critical)", rows: 2 },
    { tone: "var(--severity-high)", rows: 4 },
    { tone: "var(--severity-medium)", rows: 4 },
  ];
  return (
    <div className="pulse" style={{ marginTop: 16 }}>
      {sections.map((sec, sIdx) => (
        <div key={sIdx} style={{ marginBottom: 32 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 0",
              borderBottom: "1px solid var(--border-muted)",
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: sec.tone,
                opacity: 0.5,
              }}
            />
            <span
              style={{
                width: 140,
                height: 12,
                background: "var(--border-muted)",
                borderRadius: 4,
              }}
            />
          </div>
          {Array.from({ length: sec.rows }).map((_, i) => (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "28px minmax(280px, 1.5fr) minmax(240px, 1.3fr) 220px 180px",
                gap: 32,
                padding: "20px 8px 20px 0",
                borderBottom: "1px solid var(--border-muted)",
                alignItems: "start",
              }}
            >
              <div
                style={{
                  width: 4,
                  height: 38,
                  borderRadius: 2,
                  background: sec.tone,
                  opacity: 0.35,
                }}
              />
              <div>
                <div
                  style={{
                    width: "70%",
                    height: 14,
                    background: "var(--border-muted)",
                    borderRadius: 4,
                    marginBottom: 8,
                  }}
                />
                <div
                  style={{
                    width: "45%",
                    height: 10,
                    background: "var(--border-muted)",
                    borderRadius: 4,
                    opacity: 0.7,
                  }}
                />
              </div>
              <div>
                <div
                  style={{
                    width: "85%",
                    height: 10,
                    background: "var(--border-muted)",
                    borderRadius: 4,
                    marginBottom: 6,
                    opacity: 0.6,
                  }}
                />
                <div
                  style={{
                    width: "65%",
                    height: 10,
                    background: "var(--border-muted)",
                    borderRadius: 4,
                    opacity: 0.5,
                  }}
                />
              </div>
              <div
                style={{
                  width: "60%",
                  height: 24,
                  background: "var(--border-muted)",
                  borderRadius: 6,
                  opacity: 0.5,
                }}
              />
              <div
                style={{
                  width: "70%",
                  height: 24,
                  background: "var(--border-muted)",
                  borderRadius: 6,
                  opacity: 0.5,
                }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
  valueClass,
  isLast,
}: {
  label: string;
  value: number | string;
  delta?: string;
  valueClass?: "crit";
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        // Symmetric padding so the label never butts up against the divider.
        // The first column doesn't need left-pad (page already provides it);
        // every other column gets 28px left to give the divider breathing room.
        padding: "20px 28px",
        borderRight: isLast ? "none" : "1px solid var(--border-muted)",
        minWidth: 0,
      }}
    >
      <div
        className="mono"
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontSize: 10.5,
          color: "var(--fg-dim)",
          marginBottom: 6,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: valueClass === "crit" ? "var(--severity-critical)" : "var(--fg)",
          fontFeatureSettings: '"tnum"',
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      {delta && (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--fg-dim)",
            marginTop: 6,
            lineHeight: 1.4,
          }}
        >
          {delta}
        </div>
      )}
    </div>
  );
}

// ── Severity header ──────────────────────────────────────────────────────────

function SeverityHeader({
  sev,
  count,
  t,
}: {
  sev: Recommendation["severity"];
  count: number;
  t: (key: string) => string;
}) {
  const color: Record<Recommendation["severity"], string> = {
    critical: "var(--severity-critical)",
    high: "var(--severity-high)",
    medium: "var(--severity-medium)",
    low: "var(--severity-low)",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 12,
        padding: "28px 0 12px",
        borderBottom: "1px solid var(--border-muted)",
        marginBottom: 4,
      }}
    >
      <h2
        className="mono"
        style={{
          fontSize: 13,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          margin: 0,
          color: color[sev],
        }}
      >
        {t(SEVERITY_KEY[sev])}
      </h2>
      <span className="mono" style={{ fontSize: 12, color: "var(--fg-dim)" }}>
        {count}
      </span>
      <span style={{ flex: 1, height: 1, background: "var(--border-muted)", marginBottom: 4 }} />
    </div>
  );
}

// ── Recommendation row ───────────────────────────────────────────────────────

function RecRow({
  rec,
  resolved,
  sent,
  locale,
  t,
  onOpen,
}: {
  rec: Recommendation;
  resolved: boolean;
  sent: boolean;
  locale: "en" | "de";
  t: (key: string) => string;
  onOpen: () => void;
}) {
  const tickColor: Record<Recommendation["severity"], string> = {
    critical: "var(--severity-critical)",
    high: "var(--severity-high)",
    medium: "var(--severity-medium)",
    low: "var(--severity-low)",
  };
  const title = locale === "en" ? rec.title_en ?? rec.title : rec.title;
  const summary = locale === "en" ? rec.summary_en ?? rec.summary : rec.summary;
  const draftAction = rec.actions.find((a) => a.type === "draft_email");
  const dispatchAction = rec.actions.find((a) => a.type === "dispatch_contractor");
  const followUpAction = rec.actions.find((a) => a.type === "follow_up");
  const stepLabel =
    rec.stepLabelOverride ??
    (locale === "en"
      ? followUpAction?.label ?? dispatchAction?.label ?? draftAction?.label ?? "Review"
      : followUpAction?.label_de ?? dispatchAction?.label_de ?? draftAction?.label_de ?? "Prüfen");
  // 1 Received → 2 Reviewed → 3 Draft prepared → 4 Sent / Dispatched → 5 Resolved
  // forceStep wins for demo lifecycle rows; otherwise derive from session state
  // and the action shape. A `follow_up` action means the engine detected the
  // last communication was outgoing — we've already replied, so the case is at
  // step 4 (sent, awaiting reply) not step 3 (draft prepared).
  const totalSteps = 5;
  const hasFollowUp = rec.actions.some((a) => a.type === "follow_up");
  const hasDraft = rec.actions.some((a) => a.type === "draft_email");
  const currentStep =
    rec.forceStep ??
    (resolved
      ? 5
      : sent || hasFollowUp
        ? 4
        : hasDraft
          ? 3
          : 2);

  const threadCount = rec.email_chain?.length ?? 1;
  const lastDate = rec.email_chain?.[0]?.date ?? rec.created_at;

  return (
    <div
      onClick={onOpen}
      style={{
        display: "grid",
        gridTemplateColumns: "28px minmax(280px, 1.5fr) minmax(240px, 1.3fr) 220px 180px",
        gap: 32,
        padding: "20px 8px 20px 0",
        borderBottom: "1px solid var(--border-muted)",
        alignItems: "start",
        cursor: "pointer",
        position: "relative",
        opacity: resolved ? 0.4 : 1,
        background: "transparent",
        transition: "background 120ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(239,236,229,0.55)";
        // Prefetch email chain bodies + the Gemini reply draft so the
        // StreamPanel paints instantly when the user actually clicks.
        // Fire-and-forget; safe to spam (per-rec dedup inside).
        prefetchIncident(rec);
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {/* Severity tick */}
      <div
        style={{
          width: 4,
          height: 38,
          borderRadius: 2,
          background: tickColor[rec.severity],
        }}
      />

      {/* Title + meta */}
      <div style={{ minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 500,
            letterSpacing: "-0.005em",
            color: "var(--fg)",
            textDecorationLine: resolved ? "line-through" : "none",
            textDecorationColor: "var(--fg-dim)",
          }}
        >
          {title}
        </p>
        <div
          style={{
            marginTop: 6,
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            alignItems: "center",
            fontSize: 12,
            color: "var(--fg-muted)",
          }}
        >
          <span>{rec.entity_name}</span>
          <span style={{ color: "var(--fg-dim)" }}>·</span>
          <span style={{ color: "var(--fg-dim)" }}>{rec.entity_type}</span>
          {rec.entity_reputation && (
            <>
              <span style={{ color: "var(--fg-dim)" }}>·</span>
              <ReputationDot rep={rec.entity_reputation} entityType={rec.entity_type} />
            </>
          )}
        </div>
      </div>

      {/* Summary */}
      <div
        style={{
          fontSize: 13,
          color: "var(--fg-muted)",
          lineHeight: 1.55,
        }}
      >
        {summary.slice(0, 200)}
      </div>

      {/* Step bar — 5-stage progression: Received → Reviewed → Drafted → Sent → Resolved */}
      <div title="1 Received · 2 Reviewed · 3 Draft prepared · 4 Sent / Dispatched · 5 Resolved">
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--fg-dim)",
            marginBottom: 6,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {t("dash.recrow.step")
            .replace("{n}", String(currentStep))
            .replace("{m}", String(totalSteps))}{" "}
          · {STEP_NAMES[currentStep - 1]}
        </div>
        <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 1.5,
                background: i < currentStep ? tickColor[rec.severity] : "var(--border-muted)",
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 12, color: "var(--fg-muted)" }}>{stepLabel}</div>
      </div>

      {/* Time + thread count */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 6,
        }}
      >
        <span
          className="mono"
          suppressHydrationWarning
          style={{ fontSize: 11, color: "var(--fg-dim)" }}
        >
          {prettyDate(lastDate)}
        </span>
        <span
          className="mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "var(--fg-muted)",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M2 3h8M2 6h8M2 9h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {threadCount} {threadCount === 1 ? t("dash.recrow.msg") : t("dash.recrow.msgs")}
        </span>
      </div>
    </div>
  );
}

// ── Reputation dot ───────────────────────────────────────────────────────────

function ReputationDot({
  rep,
  entityType,
}: {
  rep: NonNullable<Recommendation["entity_reputation"]>;
  entityType: string;
}) {
  const color = {
    trusted: "var(--rep-trusted)",
    neutral: "var(--rep-neutral)",
    avoid: "var(--rep-avoid)",
  }[rep.band] ?? "var(--rep-neutral)";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        position: "relative",
      }}
      title={`${labelFor(entityType, rep)}${rep.related_units?.length ? ` · history: ${rep.related_units.join(", ")}` : ""}`}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 999,
          background: color,
          display: "inline-block",
        }}
      />
      <span style={{ fontSize: 11.5, color: "var(--fg-muted)", letterSpacing: "-0.005em" }}>
        {labelFor(entityType, rep)}
      </span>
    </span>
  );
}

// Friendly per-entity-type label so judges don't read raw 0.58 scores.
function labelFor(
  entityType: string,
  rep: NonNullable<Recommendation["entity_reputation"]>,
): string {
  if (entityType === "contractor") {
    const stars = Math.round(rep.score * 5 * 2) / 2;
    return `${stars.toFixed(1)} ★`;
  }
  if (entityType === "tenant" || entityType === "owner") {
    if (rep.score >= 0.85) return "Excellent";
    if (rep.score >= 0.7) return "Reliable";
    if (rep.score >= 0.5) return "Fine so far";
    if (rep.score >= 0.3) return "Watch";
    return "Concerning";
  }
  return rep.band;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function greetingKeyForHour(h: number): string {
  if (h < 12) return "dash.greeting.morning";
  if (h < 18) return "dash.greeting.afternoon";
  return "dash.greeting.evening";
}

const NUMBER_WORDS_EN = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
  "Eighteen", "Nineteen", "Twenty",
];

const NUMBER_WORDS_DE = [
  "Null", "Ein", "Zwei", "Drei", "Vier", "Fünf", "Sechs", "Sieben", "Acht", "Neun",
  "Zehn", "Elf", "Zwölf", "Dreizehn", "Vierzehn", "Fünfzehn", "Sechzehn", "Siebzehn",
  "Achtzehn", "Neunzehn", "Zwanzig",
];

function numberWord(n: number, locale: "en" | "de"): string {
  const table = locale === "de" ? NUMBER_WORDS_DE : NUMBER_WORDS_EN;
  if (n >= 0 && n < table.length) return table[n];
  return String(n);
}

function prettyDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `Today, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Round-robin items across categories so the visible top isn't dominated
// by any one type. Preserves original within-category order.
function interleaveByCategory(items: Recommendation[]): Recommendation[] {
  const buckets = new Map<string, Recommendation[]>();
  for (const r of items) {
    const arr = buckets.get(r.category) ?? [];
    arr.push(r);
    buckets.set(r.category, arr);
  }
  const order = Array.from(buckets.keys());
  const out: Recommendation[] = [];
  let any = true;
  while (any) {
    any = false;
    for (const cat of order) {
      const arr = buckets.get(cat)!;
      if (arr.length > 0) {
        out.push(arr.shift()!);
        any = true;
      }
    }
  }
  return out;
}

// Suppress unused-import warning — Link is reserved for future row-click → stream panel.
void Link;
