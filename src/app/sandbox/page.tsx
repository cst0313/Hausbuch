// path: src/app/sandbox/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { UploadInspector, type IngestSummary } from "@/components/UploadInspector";
import { AddEntityModal } from "@/components/AddEntityModal";
import { CmdK } from "@/components/CmdK";
import { StreamPanel, type StreamRec } from "@/components/StreamPanel";
import { ContractorPicker, type Contractor } from "@/components/ContractorPanel";

/**
 * Curated demo subset for the "Load sample bundle" button. These are
 * the five tenants in the seeded corpus with the richest mix of email
 * threads, incident types, and legal escalations — enough variety to
 * show off the dashboard's interactions (StreamPanel, draft, dispatch,
 * timeline) without dumping the full 200+ rec backlog on the demo viewer.
 */
const DEMO_ENTITY_IDS = [
  "tenant:MIE-017", // Edeltraud Renner — Mietminderung + Kündigung
  "tenant:MIE-016", // Magrit Mitschke — water_damage, mold, heating
  "tenant:MIE-008", // Ferenc Stahr — multiple incidents
  "tenant:MIE-022", // Carsten Austermühle — Mahnung
  "tenant:MIE-018", // Louise Ladeck — water_damage
];
const DEMO_REC_LIMIT = 6;

const PERSIST_KEY = "hausbuch:sandbox:v1";

type SandboxRec = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  entity_id: string;
  entity_name: string;
  entity_type?: string;
  category: string;
  title: string;
  title_en?: string;
  summary: string;
  summary_en?: string;
  facts?: Array<{ predicate: string; value: string; source_title: string; known_from: string; valid_from?: string | null }>;
  email_chain?: Array<{ source_id: string; title: string; from?: string; date?: string; excerpt?: string }>;
  actions?: Array<{ type: string; label: string; label_de: string; draft_context?: unknown }>;
  created_at?: string;
};

type SandboxSummary = {
  files_total: number;
  files_processed: number;
  facts_added: number;
  entities_touched: number;
  open_recs: number;
};

type SampleFixture = {
  summary: SandboxSummary;
  recommendations: SandboxRec[];
  info_only?: Array<{ title: string; kind: string; summary: string }>;
};

type SandboxState = "empty" | "sample" | "uploaded";

export default function SandboxPage() {
  // sandboxEntityIds tracks which entity IDs were touched by uploads in
  // this sandbox session. Used to filter /api/recommendations to JUST
  // those entities — keeps the seeded corpus's 200+ recs out of view.
  // Filtering by created_at didn't work because rec.created_at is the
  // OLDEST fact's known_from; ingesting against an entity that already
  // had old facts gave back-dated created_at values.
  const sandboxEntityIds = useRef<Set<string>>(new Set());

  const [state, setState] = useState<SandboxState>("empty");
  const [recs, setRecs] = useState<SandboxRec[]>([]);
  const [summary, setSummary] = useState<SandboxSummary | null>(null);
  const [infoOnly, setInfoOnly] = useState<SampleFixture["info_only"]>([]);
  const [busy, setBusy] = useState<"idle" | "loading-sample" | "wiping">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [streamRec, setStreamRec] = useState<SandboxRec | null>(null);
  const [streamOpen, setStreamOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTrade, setPickerTrade] = useState<string>("");
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // Hydrate sandbox state from sessionStorage on mount. Without this,
  // navigating to /context for an entity and clicking Back lands the
  // user back on /sandbox with state="empty" — losing the loaded
  // sample bundle or uploaded data.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PERSIST_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        state: SandboxState;
        recs: SandboxRec[];
        summary: SandboxSummary | null;
        infoOnly: SampleFixture["info_only"];
        entityIds: string[];
      };
      if (parsed.state && parsed.state !== "empty") {
        setState(parsed.state);
        setRecs(parsed.recs ?? []);
        setSummary(parsed.summary ?? null);
        setInfoOnly(parsed.infoOnly ?? []);
        sandboxEntityIds.current = new Set(parsed.entityIds ?? []);
      }
    } catch {
      /* sessionStorage disabled / corrupt — start fresh */
    }
  }, []);

  // Persist on every state change so Back from /context restores the view.
  useEffect(() => {
    if (state === "empty") {
      try {
        sessionStorage.removeItem(PERSIST_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      sessionStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({
          state,
          recs,
          summary,
          infoOnly,
          entityIds: [...sandboxEntityIds.current],
        }),
      );
    } catch {
      /* quota / disabled — survive without persistence */
    }
  }, [state, recs, summary, infoOnly]);

  // ⌘K / "/" opens the agent palette inside the sandbox tab.
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

  /**
   * Sample bundle: pulls a curated subset of REAL recs from the seeded
   * corpus — five tenants with the richest mix of email threads,
   * incident types, and legal escalations. The recs come back with full
   * email_chain + actions, so the sandbox StreamPanel + click-through
   * behaves identically to the live /dashboard. No hand-crafted fixture.
   */
  const loadSample = async () => {
    setBusy("loading-sample");
    setMessage(null);
    try {
      const data = (await fetch("/api/recommendations").then((r) => r.json())) as {
        recommendations?: SandboxRec[];
      };
      const all = data.recommendations ?? [];
      const allow = new Set(DEMO_ENTITY_IDS);
      const filtered = all.filter((r) => allow.has(r.entity_id));
      // Severity-sort and cap so the demo opens with a tight queue.
      const order: Record<SandboxRec["severity"], number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      const ranked = filtered
        .sort((a, b) => order[a.severity] - order[b.severity])
        .slice(0, DEMO_REC_LIMIT);
      // Track these entities as in-scope so any subsequent uploads
      // accumulate into the same sandbox view.
      sandboxEntityIds.current = new Set(ranked.map((r) => r.entity_id));
      setRecs(ranked);
      setSummary({
        files_total: ranked.length,
        files_processed: ranked.length,
        facts_added: ranked.reduce((n, r) => n + (r.facts?.length ?? 0), 0),
        entities_touched: sandboxEntityIds.current.size,
        open_recs: ranked.length,
      });
      setInfoOnly([]);
      setState("sample");
      setMessage(null);
    } catch (err) {
      setMessage(`Could not load sample: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy("idle");
    }
  };

  const openStream = (rec: SandboxRec) => {
    setStreamRec(rec);
    setStreamOpen(true);
  };
  const closeStream = () => {
    setStreamOpen(false);
    setTimeout(() => setStreamRec(null), 250);
  };

  /**
   * Real upload path. The UploadInspector hands us a summary including
   * `entities_changed` — the entities the ingest actually touched. We
   * track those IDs and filter /api/recommendations to recs whose
   * entity_id is in the set. That gives the user every rec the
   * just-uploaded data triggers, regardless of whether the entity
   * already had older facts in the seeded corpus.
   */
  const onIngested = async (ingest?: IngestSummary) => {
    if (ingest) {
      for (const e of ingest.entities_changed) {
        sandboxEntityIds.current.add(e.id);
      }
    }
    try {
      const data = (await fetch("/api/recommendations").then((r) => r.json())) as {
        recommendations?: SandboxRec[];
      };
      const all = data.recommendations ?? [];
      const ids = sandboxEntityIds.current;
      const fresh = ids.size > 0 ? all.filter((r) => ids.has(r.entity_id)) : [];

      const factsAdded = ingest?.facts_added ?? 0;
      const filesTotal = ingest?.files_total ?? 0;
      const filesProcessed = ingest?.files_processed ?? 0;

      setRecs(fresh);
      setSummary((prev) => ({
        // Sum across uploads in the same sandbox session so the strip
        // grows when the user drops more files instead of resetting.
        files_total: (prev?.files_total ?? 0) + filesTotal,
        files_processed: (prev?.files_processed ?? 0) + filesProcessed,
        facts_added: (prev?.facts_added ?? 0) + factsAdded,
        entities_touched: ids.size,
        open_recs: fresh.length,
      }));
      setInfoOnly([]);
      setState("uploaded");
      setTimeout(() => {
        document
          .getElementById("sandbox-dashboard")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    } catch (err) {
      setMessage(`Could not refresh after upload: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const resetSandbox = () => {
    if (state !== "empty" && !confirm("Reset the sandbox? Loaded data will disappear from this view.")) {
      return;
    }
    setState("empty");
    setRecs([]);
    setSummary(null);
    setInfoOnly([]);
    setMessage(null);
    sandboxEntityIds.current = new Set();
  };

  return (
    <>
      <Nav onOpenSearch={() => setPaletteOpen(true)} />

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "48px 48px 96px" }}>
        {state === "empty" ? (
          <EmptyState
            onLoadSample={loadSample}
            onIngested={onIngested}
            busy={busy}
            message={message}
          />
        ) : (
          <LoadedDashboard
            recs={recs}
            summary={summary}
            infoOnly={infoOnly ?? []}
            mode={state}
            onReset={resetSandbox}
            onAskAgent={() => setPaletteOpen(true)}
            onAddEntity={() => setAddOpen(true)}
            onIngested={onIngested}
            onOpenStream={openStream}
          />
        )}
      </main>

      <CmdK
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onOpenEntity={(id) => {
          setPaletteOpen(false);
          window.location.href = `/context/${encodeURIComponent(id)}`;
        }}
      />

      <StreamPanel
        rec={streamRec as StreamRec | null}
        open={streamOpen}
        onClose={closeStream}
        locale="en"
        sent={streamRec ? sentIds.has(streamRec.id) : false}
        resolved={streamRec ? resolvedIds.has(streamRec.id) : false}
        onResolve={() => {
          if (streamRec) {
            setResolvedIds((s) => new Set([...s, streamRec.id]));
            showToast("Marked resolved.");
          }
        }}
        onSend={() => {
          if (streamRec) {
            setSentIds((s) => new Set([...s, streamRec.id]));
            showToast("Reply sent.");
          }
        }}
        onDispatch={() => {
          // Open the contractor picker like the live dashboard does;
          // category → trade map drives which trade is preselected.
          const cat = streamRec?.category ?? "";
          const trade =
            cat.includes("water") ? "water_damage"
              : cat.includes("heat") ? "heating"
              : cat.includes("lock") || cat.includes("door") ? "lock_issue"
              : cat.includes("mold") ? "mold"
              : cat.includes("electrical") ? "electrical"
              : "water_damage";
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
          const dispatchType =
            streamRec?.category?.startsWith("incident.")
              ? streamRec.category.replace(/^incident\./, "")
              : pickerTrade || undefined;
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
            .then(() => {
              showToast(`Dispatched ${c.name}.`);
              // Refresh recs so the dispatch fact is reflected in the
              // next status-update draft + the case status.
              void onIngested();
            })
            .catch(() => showToast("Dispatch failed — check the network tab."));
        }}
      />

      <AddEntityModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(entityId) => {
          setAddOpen(false);
          // The user just manually created an entity — add its id to the
          // sandbox-scoped set so any recs tied to it surface, then
          // refetch + show a confirmation toast.
          if (entityId) sandboxEntityIds.current.add(entityId);
          showToast(`Added ${entityId}. Refreshing the queue…`);
          void onIngested();
        }}
      />

      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            padding: "10px 16px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--brand)",
            borderRadius: 8,
            color: "var(--fg)",
            fontSize: 13,
            boxShadow: "0 4px 24px rgba(0,0,0,0.15)",
            zIndex: 100,
            maxWidth: 360,
          }}
        >
          {toast}
        </div>
      )}
    </>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────

function EmptyState({
  onLoadSample,
  onIngested,
  busy,
  message,
}: {
  onLoadSample: () => void;
  onIngested: (s: IngestSummary) => void;
  busy: string;
  message: string | null;
}) {
  return (
    <>
      <section style={{ marginBottom: 32 }}>
        <p
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--fg-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: "0 0 12px",
          }}
        >
          / sandbox
        </p>
        <h1
          style={{
            fontSize: 44,
            fontWeight: 500,
            letterSpacing: "-0.025em",
            lineHeight: 1.05,
            margin: 0,
          }}
        >
          Upload your data{" "}
          <span className="serif-italic" style={{ fontWeight: 400 }}>
            to start.
          </span>
        </h1>
        <p
          style={{
            margin: "16px 0 0",
            fontSize: 15,
            color: "var(--fg-muted)",
            maxWidth: 720,
            lineHeight: 1.55,
          }}
        >
          The sandbox is empty. Drop a zip of emails / PDFs / scanned letters,
          or load the 7-document starter bundle. The pipeline builds Context.md
          per entity and surfaces what needs attention — instantly. The seeded
          corpus on the main /dashboard isn&apos;t shown here.
        </p>
      </section>

      <section
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 28,
        }}
      >
        <button
          onClick={onLoadSample}
          disabled={busy === "loading-sample"}
          style={{
            padding: "18px 22px",
            borderRadius: 12,
            border: "1px solid var(--brand)",
            background: busy === "loading-sample" ? "var(--brand-wash)" : "var(--brand)",
            color: busy === "loading-sample" ? "var(--brand)" : "white",
            fontSize: 14,
            fontWeight: 500,
            cursor: busy === "loading-sample" ? "default" : "pointer",
            fontFamily: "inherit",
            textAlign: "left",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            flex: "1 1 360px",
            minWidth: 0,
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            {busy === "loading-sample" ? "Loading sample…" : "Load sample bundle"}
          </span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>
            7 real Hausverwaltung PDFs (Mahnung, Kündigung, Hausgeld, Mieterhöhung, ETV, BKA, Vendor invoice).
          </span>
        </button>
        <a
          href="/sandbox/sample-bundle.zip"
          download
          className="mono"
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--brand)",
            fontSize: 11,
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          sample-bundle.zip ↓
        </a>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--fg-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: "0 0 14px",
            fontWeight: 600,
          }}
        >
          Or upload your own
        </h2>
        <UploadInspector onIngested={onIngested} />
      </section>


      {message && (
        <div
          className="mono"
          style={{
            marginTop: 18,
            padding: "10px 14px",
            borderRadius: 8,
            background: "rgba(220,80,60,0.08)",
            border: "1px solid var(--severity-critical)",
            fontSize: 12,
            color: "var(--severity-critical)",
          }}
        >
          {message}
        </div>
      )}
    </>
  );
}

// ── Loaded sandbox dashboard ────────────────────────────────────────────

function LoadedDashboard({
  recs,
  summary,
  infoOnly,
  mode,
  onReset,
  onAskAgent,
  onAddEntity,
  onIngested,
  onOpenStream,
}: {
  recs: SandboxRec[];
  summary: SandboxSummary | null;
  infoOnly: NonNullable<SampleFixture["info_only"]>;
  mode: "sample" | "uploaded";
  onReset: () => void;
  onAskAgent: () => void;
  onAddEntity: () => void;
  onIngested: (s: IngestSummary) => void;
  onOpenStream: (rec: SandboxRec) => void;
}) {
  const sevColor = (s: SandboxRec["severity"]) =>
    s === "critical"
      ? "var(--severity-critical)"
      : s === "high"
        ? "var(--severity-high)"
        : s === "medium"
          ? "var(--severity-medium)"
          : "var(--severity-low)";
  const sorted = useMemo(() => {
    const order: Record<SandboxRec["severity"], number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return [...recs].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [recs]);
  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <p
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--fg-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: "0 0 12px",
          }}
        >
          / sandbox · {mode === "sample" ? "sample bundle loaded" : "uploaded data"}
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <h1
            style={{
              fontSize: 36,
              fontWeight: 500,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              margin: 0,
            }}
          >
            Sandbox dashboard
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onAskAgent}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--fg)",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              Ask the agent
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "var(--bg-hover)",
                  color: "var(--fg-muted)",
                }}
              >
                ⌘K
              </span>
            </button>
            <button
              onClick={onAddEntity}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--fg)",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              + Add entity
            </button>
            <button
              onClick={onReset}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--severity-critical)",
                background: "transparent",
                color: "var(--severity-critical)",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Reset sandbox
            </button>
          </div>
        </div>
      </header>

      {summary && (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 0,
            marginBottom: 28,
            border: "1px solid var(--border)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <SummaryStat label="Documents" value={summary.files_processed} />
          <SummaryStat label="Facts added" value={summary.facts_added} />
          <SummaryStat label="Entities touched" value={summary.entities_touched} />
          <SummaryStat label="Open cases" value={summary.open_recs} crit={summary.open_recs > 0} />
        </section>
      )}

      <section
        id="sandbox-dashboard"
        style={{ marginBottom: 36, scrollMarginTop: 80 }}
      >
        {sorted.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--fg-dim)", padding: "20px 0" }}>
            No open cases yet. Drop more documents below to populate.
          </p>
        ) : (
          <div
            style={{
              borderTop: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {sorted.map((rec) => (
              <div
                key={rec.id}
                onClick={() => onOpenStream(rec)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "4px minmax(220px, 1.2fr) minmax(220px, 1fr) auto",
                  gap: 16,
                  padding: "14px 0",
                  borderBottom: "1px solid var(--border-muted)",
                  alignItems: "start",
                  cursor: "pointer",
                  transition: "background 120ms",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239,236,229,0.55)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div
                  style={{
                    width: 4,
                    height: 38,
                    borderRadius: 2,
                    background: sevColor(rec.severity),
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      letterSpacing: "-0.005em",
                      color: "var(--fg)",
                    }}
                  >
                    {rec.title}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 4 }}
                  >
                    {rec.entity_name}
                  </div>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--fg-muted)", lineHeight: 1.5 }}>
                  {rec.summary}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  <Link
                    href={`/context/${encodeURIComponent(rec.entity_id)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--brand)",
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                    }}
                  >
                    open context →
                  </Link>
                  {rec.actions && rec.actions.length > 0 && (
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: "var(--fg-dim)", whiteSpace: "nowrap" }}
                    >
                      {rec.actions.length} action{rec.actions.length === 1 ? "" : "s"} ready
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {infoOnly.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 12px",
              fontWeight: 600,
            }}
          >
            Also ingested · no manager action needed
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 8,
            }}
          >
            {infoOnly.map((d) => (
              <div
                key={d.title}
                style={{
                  padding: "12px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border-muted)",
                  background: "var(--bg)",
                }}
              >
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--fg-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    marginBottom: 4,
                  }}
                >
                  {d.kind}
                </div>
                <div
                  style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, color: "var(--fg)" }}
                >
                  {d.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.45 }}>
                  {d.summary}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section
        style={{
          marginTop: 24,
          paddingTop: 18,
          borderTop: "1px solid var(--border-muted)",
        }}
      >
        <h2
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--fg-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            margin: "0 0 12px",
            fontWeight: 600,
          }}
        >
          Add more
        </h2>
        <UploadInspector onIngested={onIngested} />
      </section>
    </>
  );
}

function SummaryStat({
  label,
  value,
  crit,
}: {
  label: string;
  value: number;
  crit?: boolean;
}) {
  return (
    <div
      style={{
        padding: "16px 20px",
        borderRight: "1px solid var(--border-muted)",
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--fg-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: crit ? "var(--severity-critical)" : "var(--fg)",
          fontFeatureSettings: '"tnum"',
        }}
      >
        {value}
      </div>
    </div>
  );
}
