// path: src/app/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { useLocale } from "@/components/LocaleProvider";
import { UploadInspector } from "@/components/UploadInspector";
import { WhyThisWins } from "@/components/WhyThisWins";

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
  const titleLines = t("hero.title").split("\n");
  const [stats, setStats] = useState<LiveStats | null>(null);

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
          <span style={{ color: "var(--fg-dim)" }}>
            Hausbuch · built in Berlin · April 2026
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
