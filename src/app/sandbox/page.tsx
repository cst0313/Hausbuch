// path: src/app/sandbox/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { UploadInspector } from "@/components/UploadInspector";
import { AddEntityModal } from "@/components/AddEntityModal";
import { CmdK } from "@/components/CmdK";

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
  // sandboxStartedAt tracks when this session opened, so when the user
  // uploads a real file we can filter /api/recommendations to recs
  // whose triggering source landed AFTER the session started — keeps
  // the seeded corpus's 200+ recs out of the sandbox view.
  const sandboxStartedAt = useRef(new Date().toISOString());

  const [state, setState] = useState<SandboxState>("empty");
  const [recs, setRecs] = useState<SandboxRec[]>([]);
  const [summary, setSummary] = useState<SandboxSummary | null>(null);
  const [infoOnly, setInfoOnly] = useState<SampleFixture["info_only"]>([]);
  const [busy, setBusy] = useState<"idle" | "loading-sample" | "wiping">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

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
   * Sample bundle: served as a precomputed JSON fixture so loading is
   * instant — no engine round trip, no waiting for /api/recommendations.
   * The fixture lives at /public/sandbox/sample-bundle-recs.json and
   * mirrors what the engine WOULD produce from the 7 PDFs (Mahnung,
   * Kündigung, Hausgeld, Mieterhöhung; plus three info-only sources).
   */
  const loadSample = async () => {
    setBusy("loading-sample");
    setMessage(null);
    try {
      const data = (await fetch("/sandbox/sample-bundle-recs.json").then((r) => r.json())) as SampleFixture;
      setRecs(data.recommendations ?? []);
      setSummary(data.summary);
      setInfoOnly(data.info_only ?? []);
      setState("sample");
      setMessage(null);
    } catch (err) {
      setMessage(`Could not load sample: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy("idle");
    }
  };

  /**
   * Real upload path. After the engine ingests, pull recommendations
   * but only keep ones whose created_at is after this sandbox session
   * started — anything older belongs to the seeded corpus and isn't
   * what the user just uploaded.
   */
  const onIngested = async () => {
    try {
      const data = (await fetch("/api/recommendations").then((r) => r.json())) as { recommendations?: SandboxRec[] };
      const all = data.recommendations ?? [];
      const fresh = all.filter((r) => (r.created_at ?? "") > sandboxStartedAt.current);
      setRecs(fresh);
      setSummary({
        files_total: fresh.length > 0 ? fresh.length : 0,
        files_processed: fresh.length,
        facts_added: fresh.reduce((n, r) => n + (r.facts?.length ?? 0), 0),
        entities_touched: new Set(fresh.map((r) => r.entity_id)).size,
        open_recs: fresh.length,
      });
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
    sandboxStartedAt.current = new Date().toISOString();
  };

  return (
    <>
      <Nav onOpenSearch={() => setPaletteOpen(true)} />

      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "48px 48px 96px" }}>
        {state === "empty" ? (
          <EmptyState
            onLoadSample={loadSample}
            onIngested={onIngested}
            onAddEntity={() => setAddOpen(true)}
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

      <AddEntityModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setAddOpen(false);
          // After creating an entity manually, treat it as upload-mode
          // so the user sees the new entity in the dashboard view.
          void onIngested();
        }}
      />
    </>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────

function EmptyState({
  onLoadSample,
  onIngested,
  onAddEntity,
  busy,
  message,
}: {
  onLoadSample: () => void;
  onIngested: () => void;
  onAddEntity: () => void;
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
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 28,
        }}
      >
        <button
          onClick={onLoadSample}
          disabled={busy === "loading-sample"}
          style={{
            padding: "20px 22px",
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
          }}
        >
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            {busy === "loading-sample" ? "Loading sample…" : "Load sample bundle"}
          </span>
          <span style={{ fontSize: 12, opacity: 0.85 }}>
            7 real Hausverwaltung PDFs (Mahnung, Kündigung, Hausgeld, Mieterhöhung, ETV, BKA, Vendor invoice). Precomputed — paints instantly.
          </span>
        </button>
        <a
          href="/sandbox/sample-bundle.zip"
          download
          className="mono"
          style={{
            padding: "20px 22px",
            borderRadius: 12,
            border: "1px dashed var(--border)",
            background: "var(--bg)",
            color: "var(--fg-muted)",
            fontSize: 12,
            fontWeight: 500,
            textDecoration: "none",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--fg)", fontWeight: 600 }}>
            sample-bundle.zip ↓
          </span>
          <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>
            Download the 7 PDFs to upload anywhere else.
          </span>
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

      <section
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          paddingTop: 18,
          borderTop: "1px solid var(--border-muted)",
          fontSize: 12,
          color: "var(--fg-dim)",
        }}
      >
        <span>Need to add a single entity manually?</span>
        <button
          onClick={onAddEntity}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
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
}: {
  recs: SandboxRec[];
  summary: SandboxSummary | null;
  infoOnly: NonNullable<SampleFixture["info_only"]>;
  mode: "sample" | "uploaded";
  onReset: () => void;
  onAskAgent: () => void;
  onAddEntity: () => void;
  onIngested: () => void;
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
                style={{
                  display: "grid",
                  gridTemplateColumns: "4px minmax(220px, 1.2fr) minmax(220px, 1fr) auto",
                  gap: 16,
                  padding: "14px 0",
                  borderBottom: "1px solid var(--border-muted)",
                  alignItems: "start",
                }}
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
