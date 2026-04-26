// path: src/app/sandbox/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Nav } from "@/components/Nav";
import { UploadInspector } from "@/components/UploadInspector";

type Counts = {
  facts: number;
  sources: number;
  entities: number;
  open: number;
  critical: number;
};

export default function SandboxPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busy, setBusy] = useState<"idle" | "wiping" | "loading-sample">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setCounts({
          facts: d.facts ?? 0,
          sources: d.sources ?? 0,
          entities: d.entities ?? 0,
          open: d.open ?? 0,
          critical: d.critical ?? 0,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const wipe = async () => {
    if (!confirm("Wipe the entire database to an empty engine? This cannot be undone — only use during a demo session.")) {
      return;
    }
    setBusy("wiping");
    setMessage(null);
    try {
      const r = await fetch("/api/sandbox/empty", { method: "POST" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMessage("Engine wiped. Drop a document below to start populating it.");
      setRefresh((n) => n + 1);
    } catch (err) {
      setMessage(`Wipe failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy("idle");
    }
  };

  const loadSample = async () => {
    setBusy("loading-sample");
    setMessage(null);
    try {
      const blob = await fetch("/sandbox/sample-bundle.zip").then((r) => {
        if (!r.ok) throw new Error("sample bundle not found");
        return r.blob();
      });
      const fd = new FormData();
      fd.append("file", blob, "sample-bundle.zip");
      const r = await fetch("/api/upload-bulk", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setMessage(
        `Loaded ${data.files_processed ?? data.files_ingested ?? "?"} of ${
          data.files_total ?? "?"
        } sample documents — ${data.facts_added ?? 0} facts added.`,
      );
      setRefresh((n) => n + 1);
    } catch (err) {
      setMessage(`Could not load sample: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy("idle");
    }
  };

  const isEmpty = (counts?.sources ?? 0) <= 1; // marker counts as 1

  return (
    <>
      <Nav />

      <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 48px 96px" }}>
        {/* Hero */}
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
            Empty engine,{" "}
            <span className="serif-italic" style={{ fontWeight: 400 }}>
              your documents.
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
            Reset the database to zero, then upload your own emails / PDFs / scanned letters
            and watch the same pipeline build a fresh Context.md per entity. Or load our
            7-document starter bundle if you want a curated tour. Everything you do here
            persists until the next reset — links from the dashboard, /context pages, and
            the agent will all reflect what you uploaded.
          </p>
        </section>

        {/* Engine state */}
        <section
          style={{
            marginBottom: 28,
            padding: 18,
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--bg-elevated)",
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 18,
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            <Stat label="Facts" value={counts?.facts ?? "—"} />
            <Stat label="Sources" value={counts?.sources ?? "—"} />
            <Stat label="Entities" value={counts?.entities ?? "—"} />
            <Stat label="Open recs" value={counts?.open ?? "—"} accent={!!counts && counts.open > 0} />
            {!!counts && counts.critical > 0 && (
              <Stat label="Critical" value={counts.critical} crit />
            )}
            <Stat
              label="State"
              value={isEmpty ? "empty" : "populated"}
              tone={isEmpty ? "muted" : "brand"}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={loadSample}
              disabled={busy !== "idle"}
              style={{
                padding: "9px 14px",
                borderRadius: 8,
                border: "1px solid var(--brand)",
                background: busy === "loading-sample" ? "var(--brand-wash)" : "var(--brand)",
                color: busy === "loading-sample" ? "var(--brand)" : "white",
                fontSize: 13,
                fontWeight: 500,
                cursor: busy !== "idle" ? "default" : "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              {busy === "loading-sample" ? "Ingesting…" : "Load sample bundle (7 docs)"}
            </button>
            <button
              onClick={wipe}
              disabled={busy !== "idle"}
              style={{
                padding: "9px 14px",
                borderRadius: 8,
                border: "1px solid var(--rep-avoid)",
                background: "transparent",
                color: "var(--rep-avoid)",
                fontSize: 13,
                fontWeight: 500,
                cursor: busy !== "idle" ? "default" : "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              {busy === "wiping" ? "Wiping…" : "Wipe to empty"}
            </button>
          </div>
        </section>

        {message && (
          <div
            className="mono"
            style={{
              marginBottom: 24,
              padding: "12px 16px",
              borderRadius: 8,
              background: "var(--brand-wash)",
              border: "1px solid var(--brand-line)",
              fontSize: 12,
              color: "var(--fg)",
            }}
          >
            ✓ {message}
          </div>
        )}

        {/* Bundle download */}
        <section
          style={{
            marginBottom: 32,
            padding: 16,
            borderRadius: 10,
            background: "var(--bg)",
            border: "1px dashed var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 13, color: "var(--fg)", fontWeight: 500 }}>
              Want to take the bundle home?
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 4 }}>
              7 real Hausverwaltung PDFs from the seed corpus. Re-upload them anywhere
              that accepts a zip → the same facts get extracted.
            </div>
          </div>
          <a
            href="/sandbox/sample-bundle.zip"
            download
            className="mono"
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--brand)",
              fontSize: 12,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            sample-bundle.zip ↓
          </a>
        </section>

        {/* The actual upload widget */}
        <section style={{ marginBottom: 36 }}>
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
            Upload your own
          </h2>
          <UploadInspector />
        </section>

        {/* Quick links */}
        <section
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            paddingTop: 18,
            borderTop: "1px solid var(--border)",
          }}
        >
          <QuickLink
            href="/dashboard"
            title="Dashboard"
            sub="See recommendations on what you uploaded"
          />
          <QuickLink
            href="/context/weg%3Aimmanuelkirchstr-26"
            title="WEG Context.md"
            sub="The aggregated document for the seeded property"
          />
          <QuickLink
            href="/research"
            title="Performance numbers"
            sub="Why the format the agent reads is 1.6× smaller"
          />
        </section>
      </main>
    </>
  );
}

function Stat({
  label,
  value,
  accent,
  crit,
  tone,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  crit?: boolean;
  tone?: "muted" | "brand";
}) {
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--fg-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: crit
            ? "var(--severity-critical)"
            : accent || tone === "brand"
              ? "var(--brand)"
              : tone === "muted"
                ? "var(--fg-muted)"
                : "var(--fg)",
          marginTop: 2,
          fontFeatureSettings: '"tnum"',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function QuickLink({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      style={{
        flex: "1 1 220px",
        padding: "12px 14px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
        textDecoration: "none",
        color: "var(--fg)",
        display: "block",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--fg)" }}>{title} →</div>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 4 }}>
        {sub}
      </div>
    </Link>
  );
}
