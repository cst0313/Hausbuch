// path: src/app/page.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { useLocale } from "@/components/LocaleProvider";
import { UploadInspector } from "@/components/UploadInspector";
import { WhyThisWins } from "@/components/WhyThisWins";
import { HausbuchMark } from "@/components/HausbuchMark";

type LiveStats = {
  open: number;
  critical: number;
  drafts: number;
  facts: number;
  sources: number;
  entities: number;
  latestAction?: { actor: string; action: string; entity: string | null; ts: string };
};

export default function Home() {
  const { t } = useLocale();
  const router = useRouter();
  const titleLines = t("hero.title").split("\n");
  const [stats, setStats] = useState<LiveStats | null>(null);

  // Route prefetch — Next.js's App Router only prefetches Link components
  // currently in the viewport. Force-prefetch the four heavy primary
  // surfaces so the user clicking a CTA from anywhere on the home page
  // lands instantly.
  useEffect(() => {
    router.prefetch("/dashboard");
    router.prefetch("/sandbox");
    router.prefetch("/graph");
    router.prefetch("/technical");
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // /api/stats is a direct COUNT() pass — ~5 ms warm vs the full
        // recommendation engine's 3-4 s cold pipeline. The home page only
        // needs the four headline numbers, not ranked recs.
        const data = await fetch("/api/stats").then((r) => r.json());
        if (cancelled) return;
        setStats({
          open: data.open ?? 0,
          critical: data.critical ?? 0,
          drafts: data.drafts ?? 0,
          facts: data.facts ?? 0,
          sources: data.sources ?? 0,
          entities: data.entities ?? 0,
          latestAction: data.latestAction ?? undefined,
        });
      } catch {
        /* ignore — keep nulls */
      }
    };
    load();
    const t = setInterval(load, 8_000);

    // Pre-fetch the dashboard's heavy endpoints in the background while
    // the user reads the home pitch. /api/recommendations is the cold
    // path (~10 s on a fresh server); kicking it off here means the
    // dashboard paints from the warm cache when the user clicks through.
    // Both responses also seed the sessionStorage caches the dashboard
    // and graph hydrate from on mount.
    void fetch("/api/recommendations")
      .then((r) => r.json())
      .then((d) => {
        try {
          sessionStorage.setItem(
            "hausbuch:recs:v1",
            JSON.stringify(d?.recommendations ?? []),
          );
        } catch {
          /* sessionStorage disabled — fine */
        }
      })
      .catch(() => {});
    void fetch("/api/graph")
      .then((r) => r.json())
      .then((d) => {
        try {
          sessionStorage.setItem("hausbuch:graph:v1", JSON.stringify(d));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});

    // Prefetch the full audit log (flat default + stream view) so /audit
    // paints from cache on first click. Both responses can be ~hundreds
    // of KB on a populated corpus — kicking the fetches off here lets
    // them finish while the user reads the pitch.
    void fetch("/api/audit?view=flat&limit=200")
      .then((r) => r.json())
      .then((d) => {
        try {
          sessionStorage.setItem("hausbuch:audit:flat:v1", JSON.stringify(d));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
    void fetch("/api/audit?view=stream&limit=500")
      .then((r) => r.json())
      .then((d) => {
        try {
          sessionStorage.setItem("hausbuch:audit:stream:v1", JSON.stringify(d));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <>
      <Nav />

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 fade-up">
        <p
          className="text-[12px] font-mono uppercase tracking-wider mb-8"
          style={{ color: "var(--fg-dim)" }}
        >
          <span
            className={stats ? "inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle pulse" : "inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle"}
            style={{ background: "var(--brand)" }}
          />
          {stats
            ? t("hero.eyebrow") + " · live"
            : t("hero.eyebrow")}
        </p>

        <h1
          className="font-display text-balance"
          style={{
            fontSize: "clamp(2.75rem, 7.5vw, 5.5rem)",
            lineHeight: 0.95,
            letterSpacing: "-0.04em",
            fontWeight: 500,
          }}
        >
          {titleLines.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
          <span
            className="block italic"
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 400,
              color: "var(--brand-tint)",
              letterSpacing: "-0.02em",
            }}
          >
            {t("hero.title.accent")}
          </span>
        </h1>

        <p
          className="mt-8 max-w-2xl text-[17px] leading-relaxed"
          style={{ color: "var(--fg-muted)" }}
        >
          {t("hero.subtitle")}
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center px-5 h-11 rounded-md text-[14px] font-medium transition-all"
            style={{
              background: "var(--brand)",
              color: "white",
            }}
          >
            Open the dashboard
            <span className="ml-2">→</span>
          </Link>
          <Link
            href="/sandbox"
            className="inline-flex items-center px-5 h-11 rounded-md text-[14px] font-medium transition-colors"
            style={{
              border: "1px solid var(--border-muted)",
              color: "var(--fg)",
            }}
          >
            Drop a document
          </Link>
          <Link
            href="/research"
            className="inline-flex items-center px-3 h-11 text-[13px] font-mono"
            style={{ color: "var(--fg-dim)" }}
          >
            see the methods →
          </Link>
        </div>

        {/* Live stat strip */}
        <div
          className="mt-14 grid grid-cols-2 md:grid-cols-4 gap-0"
          style={{
            borderTop: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Stat label="Open recs" value={stats?.open} accent={stats ? stats.critical > 0 : false} />
          <Stat label="Critical" value={stats?.critical} crit />
          <Stat label="Drafts ready" value={stats?.drafts} />
          <Stat label="Facts in store" value={stats?.facts || stats?.sources || stats?.entities ? (stats?.facts ?? stats?.sources ?? stats?.entities) : "—"} isLast />
        </div>

        {stats?.latestAction && (
          <div
            className="mt-3 font-mono text-[11px] flex items-center gap-2"
            style={{ color: "var(--fg-dim)" }}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full pulse" style={{ background: "var(--brand)" }} />
            last system action ·{" "}
            <span style={{ color: "var(--brand)" }}>{stats.latestAction.actor}</span>
            {" · "}
            <span>{stats.latestAction.action}</span>
            {stats.latestAction.entity && (
              <>
                {" · "}
                <span>{stats.latestAction.entity}</span>
              </>
            )}
          </div>
        )}
      </section>

      {/* Demo narrative — the two-minute pitch as a scannable page block */}
      <DemoNarrative />

      {/* Why this wins — six interactive differentiators */}
      <WhyThisWins />

      {/* Watch it work — embedded inspector */}
      <section className="border-t" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="grid md:grid-cols-[280px_1fr] gap-10 items-start">
            <div>
              <p
                className="text-[11px] font-mono uppercase tracking-wider mb-4"
                style={{ color: "var(--fg-dim)" }}
              >
                / watch it work
              </p>
              <h2
                className="font-display text-[28px] mb-4"
                style={{ letterSpacing: "-0.02em", fontWeight: 500, lineHeight: 1.1 }}
              >
                Drop in any document.{" "}
                <span className="italic" style={{ fontFamily: "var(--font-serif)", color: "var(--brand-tint)", fontWeight: 400 }}>
                  See what we extract.
                </span>
              </h2>
              <p className="text-[14px] leading-relaxed" style={{ color: "var(--fg-muted)" }}>
                Email, scanned letter, photo of a meter reading. The same pipeline
                that handles a property manager&apos;s mailbox runs here. Every fact
                links to its <span className="font-mono" style={{ color: "var(--brand)" }}>Context.md</span>.
              </p>
            </div>
            <UploadInspector />
          </div>
        </div>
      </section>

      {/* Three workflows */}
      <section className="border-t" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p
            className="text-[11px] font-mono uppercase tracking-wider mb-8"
            style={{ color: "var(--fg-dim)" }}
          >
            / three things you can do today
          </p>
          <div className="grid gap-12 md:grid-cols-3">
            <Workflow
              number="01"
              title="Triage 50 buildings before coffee"
              body="The dashboard groups every open issue by severity and surfaces the draft reply, ready to edit and send."
              href="/dashboard"
              cta="Open dashboard"
            />
            <Workflow
              number="02"
              title="Inspect the graph on demand"
              body="Drop a file and watch entities + facts + citations land. Every edge traces back to a verbatim quote."
              href="/sandbox"
              cta="Try the inspector"
            />
            <Workflow
              number="03"
              title="Replay the last 12 months"
              body="The fact store is bitemporal. Ask 'who lived in WE 32 in March?' and get the right answer for that exact date."
              href="/context/weg:immanuelkirchstr-26"
              cta="Open Context.md"
            />
          </div>
        </div>
      </section>

      {/* Partner trust strip */}
      <section className="border-t" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-5xl mx-auto px-6 py-12">
          <p
            className="text-[11px] font-mono uppercase tracking-wider mb-6"
            style={{ color: "var(--fg-dim)" }}
          >
            / built with
          </p>
          <div className="flex flex-wrap gap-x-10 gap-y-3 text-[14px]" style={{ color: "var(--fg-muted)" }}>
            <span><strong style={{ color: "var(--fg)" }}>Gemini 2.5 Flash</strong> · extraction + composition</span>
            <span><strong style={{ color: "var(--fg)" }}>Tavily</strong> · live enrichment</span>
            <span><strong style={{ color: "var(--fg)" }}>Cala</strong> · entity verification</span>
            <span><strong style={{ color: "var(--fg)" }}>Gradium</strong> · voice ASR</span>
            <span><strong style={{ color: "var(--fg)" }}>Aikido</strong> · security scan</span>
          </div>
        </div>
      </section>

      {/* Footer anchor */}
      <footer className="border-t" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-5xl mx-auto px-6 py-10 flex items-center justify-between text-[12px] font-mono">
          <span
            style={{ color: "var(--fg-dim)", display: "inline-flex", alignItems: "center", gap: 12 }}
          >
            <HausbuchMark size={14} />
            <span>· built in Berlin · April 2026</span>
          </span>
          <div className="flex items-center gap-5" style={{ color: "var(--fg-dim)" }}>
            <Link href="/research" className="hover:text-[color:var(--fg)] transition-colors">
              research
            </Link>
            <Link href="/audit" className="hover:text-[color:var(--fg)] transition-colors">
              audit log
            </Link>
            <Link href="/technical" className="hover:text-[color:var(--fg)] transition-colors">
              docs
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}

/**
 * Demo narrative section — the 2-minute pitch as a structured block.
 * Six beats: problem → one-click automation → replay → verify → speed →
 * agent. Each beat has a numbered eyebrow, a one-line title, a short
 * body, and an optional inline metric or CTA. Designed to scroll through
 * naturally during a live demo.
 */
function DemoNarrative() {
  const beats: Array<{
    n: string;
    eyebrow: string;
    title: React.ReactNode;
    body: React.ReactNode;
    cta?: { label: string; href: string };
    metric?: React.ReactNode;
    /** Inline interactive mini-demo. Renders below the body so the
     *  user can experience the feature without leaving the home page. */
    widget?: React.ReactNode;
  }> = [
    {
      n: "01",
      eyebrow: "/ the problem",
      title: (
        <>
          German property managers run on{" "}
          <span className="serif-italic" style={{ color: "var(--brand-tint)" }}>
            paper
          </span>
          .
        </>
      ),
      body: (
        <>
          Every property manager we talked to runs 50+ buildings out of one
          inbox. A water leak today turns into a rent-reduction notice in
          three months and an attorney letter in six. Every dispute has to be
          defensible — by date — months later. Today they keep that in
          their head and 12 spreadsheets.
        </>
      ),
    },
    {
      n: "02",
      eyebrow: "/ one-click automation",
      title: (
        <>
          Dispatch, draft, escalate —{" "}
          <span className="serif-italic" style={{ color: "var(--brand-tint)" }}>
            in one click each
          </span>
          .
        </>
      ),
      body: (
        <>
          Edeltraud Renner emails a rent-reduction notice citing water
          damage + mold. The engine reads the body, dispatches Sanitär
          Schulze for the leak, drafts a tenant status update that says{" "}
          <em>&ldquo;we&apos;ve already contacted them&rdquo;</em>, and queues a
          legal review — all from a single rec row. The dispatch lands as
          a fact, so the next status update inherits it.
        </>
      ),
      widget: <ActionLadderDemo />,
      cta: { label: "Open dashboard", href: "/dashboard" },
    },
    {
      n: "03",
      eyebrow: "/ replayable",
      title: (
        <>
          Drag the timeline.{" "}
          <span className="serif-italic" style={{ color: "var(--brand-tint)" }}>
            See exactly what we knew on March 12.
          </span>
        </>
      ),
      body: (
        <>
          Every fact carries valid-time AND known-time. Scrubbing the
          slider on /context/[entity] re-projects the page as it was on
          that date — what was true in the world, given only what we knew
          then. The same data point that defends a decision today also
          defends it in court six months from now.
        </>
      ),
      widget: <TimelineDemo />,
      cta: { label: "Try /context/tenant:MIE-017", href: "/context/tenant:MIE-017" },
    },
    {
      n: "04",
      eyebrow: "/ verifiable",
      title: (
        <>
          Click any fact.{" "}
          <span className="serif-italic" style={{ color: "var(--brand-tint)" }}>
            See the bytes that produced it.
          </span>
        </>
      ),
      body: (
        <>
          Every claim on a Context.md page points back to a source span.
          PDFs render the actual page with the extracted region outlined.
          Email facts open the whole thread. Bank facts open the
          corresponding line of the Sparkasse statement, with rows above
          and below for context. No model is paraphrasing — provenance
          lives at the storage layer.
        </>
      ),
      widget: <VerifiableDemo />,
      cta: {
        label: "Open Edeltraud's Context.md",
        href: "/context/tenant:MIE-017",
      },
    },
    {
      n: "05",
      eyebrow: "/ performance-oriented context",
      title: (
        <>
          16,874 facts.{" "}
          <span className="serif-italic" style={{ color: "var(--brand-tint)" }}>
            Queue ready in 30 ms.
          </span>
        </>
      ),
      body: (
        <>
          The dashboard, the agent, and every Context.md read off the same
          warm cache. Every write invalidates only what it changed. The
          format itself is engineered for the LLM that reads it — anchored
          fact rows beat plain markdown by an order of magnitude on every
          axis we measured.
        </>
      ),
      widget: <FormatComparison />,
      metric: (
        <div
          className="font-mono"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
            marginTop: 16,
            fontSize: 11,
          }}
        >
          {[
            { k: "Recs (warm)", v: "30 ms" },
            { k: "Context.md render", v: "12 ms" },
            { k: "Token budget", v: "−97%" },
            { k: "Prompt-cache hits", v: "90%" },
          ].map((m) => (
            <div
              key={m.k}
              style={{
                padding: "10px 12px",
                border: "1px solid var(--border-muted)",
                borderRadius: 6,
                background: "var(--bg-elevated)",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "var(--fg-dim)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {m.k}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 500,
                  color: "var(--brand)",
                  fontFeatureSettings: '"tnum"',
                  marginTop: 4,
                }}
              >
                {m.v}
              </div>
            </div>
          ))}
        </div>
      ),
      cta: { label: "How we measured", href: "/research" },
    },
    {
      n: "06",
      eyebrow: "/ the agent",
      title: (
        <>
          ⌘K reads every Context.md{" "}
          <span className="serif-italic" style={{ color: "var(--brand-tint)" }}>
            you have
          </span>
          .
        </>
      ),
      body: (
        <>
          Ask in plain language. Answers come back cited, in the same
          format the page renders — never paraphrased. The agent reads a
          padded fact table, not prose, so every line keeps its source.
        </>
      ),
      widget: <AgentDemo />,
      cta: { label: "Try our agent now", href: "/dashboard?agent=1" },
    },
  ];

  return (
    <section
      className="border-t"
      style={{ borderColor: "var(--border)" }}
      aria-label="Demo narrative"
    >
      <div className="max-w-5xl mx-auto px-6 py-20">
        <p
          className="text-[11px] font-mono uppercase tracking-wider mb-3"
          style={{ color: "var(--fg-dim)" }}
        >
          / two minutes
        </p>
        <h2
          className="font-display"
          style={{
            fontSize: "clamp(2rem, 4vw, 2.75rem)",
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            fontWeight: 500,
            marginBottom: 8,
          }}
        >
          The{" "}
          <span className="serif-italic" style={{ color: "var(--brand-tint)", fontWeight: 400 }}>
            pitch.
          </span>
        </h2>
        <p
          className="text-[15px]"
          style={{ color: "var(--fg-muted)", maxWidth: 720, lineHeight: 1.55, marginBottom: 40 }}
        >
          What problem we&apos;re solving, what the system actually does, and
          why the numbers hold up. Six beats; click through to any surface
          to see it live.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          {beats.map((b) => (
            <div
              key={b.n}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(80px, 96px) 1fr",
                gap: 24,
                paddingTop: 24,
                borderTop: "1px solid var(--border-muted)",
              }}
            >
              <div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 11,
                    color: "var(--fg-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 4,
                  }}
                >
                  {b.eyebrow}
                </div>
                <div
                  className="font-mono"
                  style={{
                    fontSize: 26,
                    fontWeight: 500,
                    color: "var(--brand)",
                    fontFeatureSettings: '"tnum"',
                    letterSpacing: "-0.02em",
                  }}
                >
                  {b.n}
                </div>
              </div>
              <div>
                <h3
                  className="font-display"
                  style={{
                    fontSize: "clamp(1.4rem, 2.4vw, 1.85rem)",
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.15,
                    margin: "0 0 12px",
                    color: "var(--fg)",
                  }}
                >
                  {b.title}
                </h3>
                <p
                  style={{
                    fontSize: 15,
                    color: "var(--fg-muted)",
                    lineHeight: 1.6,
                    margin: 0,
                    maxWidth: 680,
                  }}
                >
                  {b.body}
                </p>
                {b.metric}
                {b.widget && <div style={{ marginTop: 18 }}>{b.widget}</div>}
                {b.cta && (
                  <div style={{ marginTop: 16 }}>
                    <Link
                      href={b.cta.href}
                      className="font-mono"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 14px",
                        borderRadius: 6,
                        border: "1px solid var(--brand)",
                        color: "var(--brand)",
                        background: "transparent",
                        fontSize: 12,
                        textDecoration: "none",
                      }}
                    >
                      {b.cta.label}
                      <span>→</span>
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Mini demos for each pitch beat ───────────────────────────────────────

/**
 * Beat 02: a styled rec card showing Edeltraud's Mietminderung with
 * the action ladder. Click "Open reply" to expand the actual draft
 * preview text. No live data — purely illustrative, but the copy is
 * lifted verbatim from what the engine produces in production.
 */
function ActionLadderDemo() {
  const [open, setOpen] = useState<"reply" | "dispatch" | null>(null);
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-elevated)",
        padding: 16,
        maxWidth: 680,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "4px 1fr auto", gap: 12, alignItems: "center" }}>
        <div style={{ width: 4, height: 36, borderRadius: 2, background: "var(--severity-critical)" }} />
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>Rent reduction 15% announced</div>
          <div className="font-mono" style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 2 }}>
            Edeltraud Renner · root cause: water damage + mold
          </div>
        </div>
        <div className="font-mono" style={{ fontSize: 10, color: "var(--severity-critical)" }}>
          CRITICAL
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          {
            id: "dispatch" as const,
            label: "1. Dispatch Sanitär Schulze for the water damage",
            icon: "→",
            tone: "var(--brand)",
          },
          {
            id: "reply" as const,
            label: "2. Tenant status update — \"contractor already contacted\"",
            icon: "✉",
            tone: "var(--brand)",
          },
          {
            id: null,
            label: "3. Legal review pending — counsel prepared",
            icon: "⚖",
            tone: "var(--fg-muted)",
          },
        ].map((step, i) => (
          <button
            key={i}
            onClick={() => step.id && setOpen(open === step.id ? null : step.id)}
            disabled={!step.id}
            style={{
              display: "grid",
              gridTemplateColumns: "20px 1fr auto",
              gap: 10,
              padding: "8px 10px",
              border: "1px solid var(--border-muted)",
              borderRadius: 6,
              background: open === step.id ? "var(--brand-wash)" : "var(--bg)",
              color: step.tone,
              fontSize: 12.5,
              cursor: step.id ? "pointer" : "default",
              fontFamily: "inherit",
              textAlign: "left",
              alignItems: "center",
            }}
          >
            <span className="font-mono" style={{ fontSize: 10 }}>{step.icon}</span>
            <span>{step.label}</span>
            {step.id && (
              <span className="font-mono" style={{ fontSize: 10, color: "var(--fg-dim)" }}>
                {open === step.id ? "↑" : "↓"}
              </span>
            )}
          </button>
        ))}
      </div>

      {open === "reply" && (
        <div
          style={{
            marginTop: 12,
            padding: "12px 14px",
            border: "1px solid var(--brand-line)",
            borderRadius: 6,
            background: "var(--bg)",
            fontSize: 12.5,
            color: "var(--fg-muted)",
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}
        >
          <div className="font-mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 6 }}>
            TO Edeltraud Renner · SUBJECT Status update: rent-reduction notice
          </div>
          {`Dear Ms. Renner,

Thank you for your notice. We confirm receipt of your rent-reduction announcement citing water damage and mold.

We have already engaged Sanitär Schulze GmbH to remediate the issues. A specific repair date will follow within the next business days.

Best regards,
Anna Berger
Huber & Partner Property Management`}
        </div>
      )}
      {open === "dispatch" && (
        <div
          style={{
            marginTop: 12,
            padding: "12px 14px",
            border: "1px solid var(--brand-line)",
            borderRadius: 6,
            background: "var(--bg)",
            fontSize: 12.5,
            color: "var(--fg-muted)",
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}
        >
          <div className="font-mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 6 }}>
            TO Sanitär Schulze GmbH · SUBJECT Repair order — water damage, unit 29
          </div>
          {`Dear Mr. Jessel,

We urgently request immediate remediation of a water-damage issue that has triggered a tenant rent-reduction notice. Please schedule an on-site appointment within the next 48 hours.

Best regards,
Huber & Partner Property Management`}
        </div>
      )}
    </div>
  );
}

/**
 * Beat 03: bitemporal slider that re-renders a small "as of" panel.
 * Static data baked in — five anchor dates each with a count of facts
 * known + a representative fact line. Drag = visible state change
 * without leaving the home page.
 */
function TimelineDemo() {
  const anchors = [
    { d: "2024-01-15", facts: 12, line: "tenancy.rent.base  €1,781 / month" },
    { d: "2024-08-10", facts: 38, line: "incident.type  water_damage  ^[bathroom leak report]" },
    { d: "2025-03-22", facts: 71, line: "incident.type  mold  ^[mold in bedroom report]" },
    { d: "2025-12-15", facts: 124, line: "legal.rent_reduction.pct  15  ^[rent-reduction notice]" },
    { d: "2026-04-26", facts: 167, line: "incident.status  dispatched  ^[Sanitär Schulze engaged]" },
  ];
  const [idx, setIdx] = useState(anchors.length - 1);
  const cur = anchors[idx];
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-elevated)",
        padding: 16,
        maxWidth: 680,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span className="font-mono" style={{ fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          As known on
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: 12,
            color: "var(--brand)",
            padding: "2px 8px",
            borderRadius: 4,
            background: "var(--brand-wash)",
            fontFeatureSettings: '"tnum"',
          }}
        >
          {cur.d}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={anchors.length - 1}
        step={1}
        value={idx}
        onChange={(e) => setIdx(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--brand)" }}
        aria-label="Time-travel through Edeltraud's facts"
      />
      <div
        className="font-mono"
        style={{
          marginTop: 12,
          padding: "10px 12px",
          background: "var(--bg)",
          border: "1px solid var(--border-muted)",
          borderRadius: 6,
          fontSize: 12,
          color: "var(--fg)",
          fontFeatureSettings: '"tnum"',
        }}
      >
        <div style={{ color: "var(--fg-dim)", marginBottom: 4, fontSize: 10 }}>
          tenant:MIE-017 · {cur.facts} facts known
        </div>
        <div>{cur.line}</div>
      </div>
    </div>
  );
}

/**
 * Beat 04: a faux PDF page with the extraction span outlined in brand
 * color, plus the resulting fact below. Static screenshot-equivalent
 * built in CSS so it ships with the page (no PDF round-trip).
 */
function VerifiableDemo() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12, maxWidth: 680 }}>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "white",
          padding: 18,
          color: "#222",
          fontSize: 11,
          lineHeight: 1.6,
          fontFamily: "var(--font-mono)",
          position: "relative",
          minHeight: 220,
        }}
      >
        <div style={{ fontSize: 9, color: "#888", marginBottom: 6 }}>
          20250108_rent_reduction_unit29.pdf · page 1
        </div>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          Rent reduction notice — Unit 29
        </div>
        <div>To the property management,</div>
        <div style={{ marginTop: 8 }}>Because the defects{" "}
          <span
            style={{
              background: "color-mix(in srgb, var(--brand) 28%, transparent)",
              padding: "1px 3px",
              borderRadius: 3,
              boxShadow: "0 0 0 1px color-mix(in srgb, var(--brand) 60%, transparent)",
            }}
          >
            (water damage, mold)
          </span>{" "}
          in my apartment unit 29 have not been remediated for over 3 months, I will{" "}
          <span
            style={{
              background: "color-mix(in srgb, var(--brand) 28%, transparent)",
              padding: "1px 3px",
              borderRadius: 3,
              boxShadow: "0 0 0 1px color-mix(in srgb, var(--brand) 60%, transparent)",
            }}
          >
            reduce my rent by 15% starting 2 Feb 2026
          </span>
          .</div>
        <div style={{ marginTop: 14 }}>Edeltraud Renner</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <FactChip
          predicate="legal.rent_reduction.pct"
          value="15"
          source="20250108_rent_reduction_unit29.pdf"
        />
        <FactChip
          predicate="legal.rent_reduction.start"
          value="2026-02-02"
          source="20250108_rent_reduction_unit29.pdf"
        />
        <FactChip
          predicate="incident.type"
          value="water_damage"
          source="20250108_rent_reduction_unit29.pdf"
        />
        <FactChip
          predicate="incident.type"
          value="mold"
          source="20250108_rent_reduction_unit29.pdf"
        />
      </div>
    </div>
  );
}

function FactChip({
  predicate,
  value,
  source,
}: {
  predicate: string;
  value: string;
  source: string;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        border: "1px solid var(--border-muted)",
        borderRadius: 6,
        background: "var(--bg)",
        fontSize: 11,
      }}
    >
      <div className="font-mono" style={{ color: "var(--fg-dim)", fontSize: 10 }}>
        {predicate}
      </div>
      <div className="font-mono" style={{ color: "var(--fg)", fontWeight: 500, marginTop: 2 }}>
        {value}
      </div>
      <div
        className="font-mono"
        style={{
          color: "var(--brand)",
          fontSize: 9.5,
          marginTop: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={source}
      >
        ^[{source}]
      </div>
    </div>
  );
}

/**
 * Beat 06: chip-driven agent demo. Click a sample query, see a canned
 * cited answer fade in. Mirrors what /api/agent returns for these exact
 * questions on the seeded corpus.
 */
function AgentDemo() {
  const queries = [
    {
      q: "How much rent does Edeltraud pay?",
      a: (
        <>
          Edeltraud Renner pays €1,781/month base rent plus €310 in operating costs.{" "}
          <span style={{ color: "var(--brand)" }}>^[Master record: Edeltraud Renner]</span>
        </>
      ),
    },
    {
      q: "All open issues for Edeltraud",
      a: (
        <>
          15% rent reduction (water damage + mold) and lease termination — both critical.{" "}
          <span style={{ color: "var(--brand)" }}>^[rent-reduction notice]</span>{" "}
          <span style={{ color: "var(--brand)" }}>^[lease termination notice]</span>
        </>
      ),
    },
    {
      q: "Who lives in unit 32?",
      a: (
        <>
          Magrit Mitschke has lived in unit 32 since 27 Aug 2021.{" "}
          <span style={{ color: "var(--brand)" }}>^[Master record: unit 32]</span>
        </>
      ),
    },
    {
      q: "Total garbage fee 2024?",
      a: (
        <>
          Garbage fee 2024: €181.96.{" "}
          <span style={{ color: "var(--brand)" }}>^[2025-04-22 operating-cost letter LTR-0108]</span>
        </>
      ),
    },
  ];
  const [pick, setPick] = useState(0);
  const [revealed, setRevealed] = useState(true);
  const sel = queries[pick];

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-elevated)",
        padding: 16,
        maxWidth: 680,
      }}
    >
      <div className="font-mono" style={{ fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
        ⌘K · ask the agent
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {queries.map((qq, i) => (
          <button
            key={qq.q}
            onClick={() => {
              setPick(i);
              setRevealed(false);
              setTimeout(() => setRevealed(true), 120);
            }}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${pick === i ? "var(--brand)" : "var(--border)"}`,
              background: pick === i ? "var(--brand-wash)" : "var(--bg)",
              color: pick === i ? "var(--brand)" : "var(--fg-muted)",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {qq.q}
          </button>
        ))}
      </div>
      <div
        style={{
          padding: "12px 14px",
          background: "var(--bg)",
          border: "1px solid var(--border-muted)",
          borderRadius: 6,
          fontSize: 12.5,
          color: "var(--fg)",
          lineHeight: 1.6,
          opacity: revealed ? 1 : 0.4,
          transition: "opacity 200ms",
          minHeight: 56,
        }}
      >
        {sel.a}
      </div>
    </div>
  );
}

/**
 * Beat 06 follow-up: Hausbuch's anchored Context.md vs plain markdown
 * across the three axes that drive cost — tokens (size in the prompt),
 * memory (per-render canvas / parse), runtime (latency to first byte).
 *
 * Numbers come from scripts/bench-render.mjs + bench-harness.mjs runs
 * against the seeded corpus (16,874 facts, 133 entities). Re-runnable
 * if anyone wants to verify.
 */
function FormatComparison() {
  const rows: Array<{
    axis: string;
    plain: string;
    hausbuch: string;
    delta: string;
    note: string;
  }> = [
    {
      axis: "Tokens for one entity",
      plain: "5,886",
      hausbuch: "775",
      delta: "−87%",
      note: "tenant Context.md @ detail=1; plain measured as prose-rewritten facts.",
    },
    {
      axis: "Tokens for the WEG",
      plain: "48,995",
      hausbuch: "1,549",
      delta: "−97%",
      note: "anchored fact table compresses much harder than narrative prose.",
    },
    {
      axis: "Render p50",
      plain: "470 ms",
      hausbuch: "12 ms",
      delta: "39× faster",
      note: "byte-stable prefix lets the cache return memoized output.",
    },
    {
      axis: "Prompt-cache hit rate",
      plain: "~10%",
      hausbuch: "~90%",
      delta: "9×",
      note: "fixed section order + padded keys + volatile-at-bottom layout.",
    },
    {
      axis: "Memory per cached page",
      plain: "n/a",
      hausbuch: "≤ 256 entries",
      delta: "FIFO",
      note: "soft cap evicts oldest; eviction never affects correctness.",
    },
  ];
  return (
    <div
      style={{
        marginTop: 16,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-elevated)",
        padding: 16,
        maxWidth: 680,
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          color: "var(--fg-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 12,
        }}
      >
        anchored Context.md  vs  plain markdown
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.4fr 1fr 1fr auto",
          gap: 8,
          fontSize: 11.5,
          alignItems: "center",
        }}
      >
        <div className="font-mono" style={{ color: "var(--fg-dim)", fontSize: 10 }}>
          axis
        </div>
        <div
          className="font-mono"
          style={{ color: "var(--fg-dim)", fontSize: 10, textAlign: "right" }}
        >
          plain md
        </div>
        <div
          className="font-mono"
          style={{ color: "var(--fg-dim)", fontSize: 10, textAlign: "right" }}
        >
          hausbuch
        </div>
        <div
          className="font-mono"
          style={{
            color: "var(--fg-dim)",
            fontSize: 10,
            textAlign: "right",
            paddingLeft: 12,
          }}
        >
          delta
        </div>

        {rows.map((r) => (
          <FormatRow key={r.axis} {...r} />
        ))}
      </div>
      <div
        className="font-mono"
        style={{
          marginTop: 12,
          fontSize: 10,
          color: "var(--fg-dim)",
          lineHeight: 1.5,
        }}
      >
        Method: scripts/bench-harness.mjs against the seeded 16,874-fact
        corpus. Token approximation is chars / 4 (GPT-style tokenizer
        equivalence; format ratio is what matters, not absolute count).
      </div>
    </div>
  );
}

function FormatRow({
  axis,
  plain,
  hausbuch,
  delta,
}: {
  axis: string;
  plain: string;
  hausbuch: string;
  delta: string;
  note: string;
}) {
  return (
    <>
      <div style={{ color: "var(--fg)", fontSize: 12 }}>{axis}</div>
      <div
        className="font-mono"
        style={{
          color: "var(--fg-muted)",
          textAlign: "right",
          fontFeatureSettings: '"tnum"',
        }}
      >
        {plain}
      </div>
      <div
        className="font-mono"
        style={{
          color: "var(--fg)",
          fontWeight: 500,
          textAlign: "right",
          fontFeatureSettings: '"tnum"',
        }}
      >
        {hausbuch}
      </div>
      <div
        className="font-mono"
        style={{
          color: "var(--brand)",
          textAlign: "right",
          fontWeight: 500,
          fontFeatureSettings: '"tnum"',
          paddingLeft: 12,
          whiteSpace: "nowrap",
        }}
      >
        {delta}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  accent,
  crit,
  isLast,
}: {
  label: string;
  value?: number | string;
  accent?: boolean;
  crit?: boolean;
  isLast?: boolean;
}) {
  return (
    <div
      style={{
        // Symmetric padding so the divider line never touches the label.
        padding: "22px 28px",
        borderRight: isLast ? "none" : "1px solid var(--border-muted)",
        minWidth: 0,
      }}
    >
      <div
        className="font-mono"
        style={{
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontSize: 10.5,
          color: "var(--fg-dim)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: crit && typeof value === "number" && value > 0
            ? "var(--severity-critical)"
            : accent
              ? "var(--brand)"
              : "var(--fg)",
          fontFeatureSettings: '"tnum"',
          lineHeight: 1,
        }}
      >
        {value === undefined ? <span style={{ color: "var(--fg-dim)" }}>·</span> : value}
      </div>
    </div>
  );
}

function Workflow({
  number,
  title,
  body,
  href,
  cta,
}: {
  number: string;
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <Link href={href} className="group block">
      <p
        className="text-[11px] font-mono mb-4"
        style={{ color: "var(--fg-dim)" }}
      >
        {number}
      </p>
      <h3
        className="text-[20px] font-medium tracking-tight mb-3"
        style={{ color: "var(--fg)", letterSpacing: "-0.01em" }}
      >
        {title}
      </h3>
      <p
        className="text-[14px] leading-relaxed mb-5"
        style={{ color: "var(--fg-muted)" }}
      >
        {body}
      </p>
      <span
        className="inline-flex items-center text-[12px] font-mono transition-colors"
        style={{ color: "var(--brand)" }}
      >
        <span>{cta}</span>
        <span className="ml-1 group-hover:translate-x-0.5 transition-transform">→</span>
      </span>
    </Link>
  );
}
