// path: src/app/page.tsx
"use client";

import Link from "next/link";
import { Nav } from "@/components/Nav";
import { useLocale } from "@/components/LocaleProvider";

export default function Home() {
  const { t } = useLocale();
  const titleLines = t("hero.title").split("\n");

  return (
    <>
      <Nav />

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-28 pb-32 fade-up">
        <p
          className="text-[13px] font-mono uppercase tracking-wider mb-10"
          style={{ color: "var(--fg-dim)" }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle"
            style={{ background: "var(--brand)" }}
          />
          {t("hero.eyebrow")}
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
          className="mt-10 max-w-2xl text-[18px] leading-relaxed"
          style={{ color: "var(--fg-muted)" }}
        >
          {t("hero.subtitle")}
        </p>

        <div className="mt-12 flex flex-wrap items-center gap-3">
          <Link
            href="/inbox"
            className="inline-flex items-center px-5 h-11 rounded-md text-[14px] font-medium transition-all"
            style={{
              background: "var(--fg)",
              color: "var(--bg)",
            }}
          >
            {t("hero.cta")}
            <span className="ml-2">→</span>
          </Link>
          <Link
            href="/context/berliner-str-42"
            className="inline-flex items-center px-5 h-11 rounded-md text-[14px] font-medium transition-colors"
            style={{
              border: "1px solid var(--border-muted)",
              color: "var(--fg)",
            }}
          >
            {t("hero.cta.secondary")}
          </Link>
        </div>
      </section>

      {/* Workflows */}
      <section
        className="border-t"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="max-w-5xl mx-auto px-6 py-24 grid gap-16 md:grid-cols-3">
          <Workflow
            number="01"
            titleKey="workflows.inbox.title"
            bodyKey="workflows.inbox.body"
            href="/inbox"
          />
          <Workflow
            number="02"
            titleKey="workflows.queue.title"
            bodyKey="workflows.queue.body"
            href="/queue"
          />
          <Workflow
            number="03"
            titleKey="workflows.replay.title"
            bodyKey="workflows.replay.body"
            href="/context/berliner-str-42"
          />
        </div>
      </section>

      {/* Proof */}
      <section
        className="border-t"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="max-w-3xl mx-auto px-6 py-32 text-center">
          <p
            className="font-serif italic text-balance"
            style={{
              fontSize: "clamp(2rem, 4vw, 3rem)",
              lineHeight: 1.15,
              color: "var(--fg)",
            }}
          >
            {t("proof.title")}
          </p>
          <p
            className="mt-6 text-[15px]"
            style={{ color: "var(--fg-muted)" }}
          >
            {t("proof.body")}
          </p>
        </div>
      </section>

      {/* Footer anchor — discreet research link */}
      <footer
        className="border-t"
        style={{ borderColor: "var(--border)" }}
      >
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
            <a
              href="https://github.com/jchang/hausbuch"
              className="hover:text-[color:var(--fg)] transition-colors"
            >
              github
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}

function Workflow({
  number,
  titleKey,
  bodyKey,
  href,
}: {
  number: string;
  titleKey: string;
  bodyKey: string;
  href: string;
}) {
  const { t } = useLocale();
  return (
    <Link href={href} className="group block">
      <p
        className="text-[11px] font-mono mb-4"
        style={{ color: "var(--fg-dim)" }}
      >
        {number}
      </p>
      <h3
        className="text-[20px] font-semibold tracking-tight mb-3"
        style={{ color: "var(--fg)", letterSpacing: "-0.01em" }}
      >
        {t(titleKey)}
      </h3>
      <p
        className="text-[14px] leading-relaxed"
        style={{ color: "var(--fg-muted)" }}
      >
        {t(bodyKey)}
      </p>
      <span
        className="inline-flex items-center mt-5 text-[12px] font-mono transition-colors"
        style={{ color: "var(--fg-dim)" }}
      >
        <span className="group-hover:text-[color:var(--brand-tint)] transition-colors">
          open
        </span>
        <span className="ml-1 group-hover:translate-x-0.5 transition-transform">→</span>
      </span>
    </Link>
  );
}
