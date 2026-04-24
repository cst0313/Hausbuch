// path: src/app/inbox/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { useLocale } from "@/components/LocaleProvider";

type Building = {
  id: string;
  name: string;
  new: DigestItem[];
  decide: DigestItem[];
  changed: DigestItem[];
};

type DigestItem = {
  predicate: string;
  value: string;
  source: string;
  when: string;
  kind?: "conflict" | "superseded" | "added";
};

export default function InboxPage() {
  const { t } = useLocale();
  const [buildings, setBuildings] = useState<Building[] | null>(null);

  useEffect(() => {
    // Placeholder: pull from the seeded entity. Real multi-entity digest
    // wires in Phase 3 with the action log (FR-7 / FR-8).
    fetch("/api/context/property%3Aberliner-str-42?detail=3&format=json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data) => {
        if (!data) {
          setBuildings([demoBuilding]);
        } else {
          setBuildings([demoBuilding]);
        }
      });
  }, []);

  return (
    <>
      <Nav />
      <main className="max-w-5xl mx-auto px-6 pt-16 pb-24 fade-up">
        <header className="mb-12">
          <h1
            className="font-display"
            style={{
              fontSize: "clamp(2rem, 4.5vw, 3rem)",
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              fontWeight: 500,
            }}
          >
            {t("inbox.title")}
          </h1>
          <p className="mt-3 text-[15px]" style={{ color: "var(--fg-muted)" }}>
            {t("inbox.subtitle")}
          </p>
        </header>

        {buildings === null && (
          <p style={{ color: "var(--fg-muted)" }}>{t("common.loading")}</p>
        )}

        {buildings?.length === 0 && (
          <p style={{ color: "var(--fg-muted)" }}>{t("common.empty")}</p>
        )}

        <div className="space-y-16">
          {buildings?.map((b) => <BuildingDigest key={b.id} building={b} />)}
        </div>
      </main>
    </>
  );
}

function BuildingDigest({ building }: { building: Building }) {
  const { t } = useLocale();
  return (
    <article>
      <div className="flex items-baseline justify-between mb-6">
        <h2
          className="text-[22px] font-semibold tracking-tight"
          style={{ color: "var(--fg)", letterSpacing: "-0.015em" }}
        >
          {building.name}
        </h2>
        <Link
          href={`/context/${building.id.replace("property:", "")}`}
          className="text-[12px] font-mono transition-colors hover:text-[color:var(--fg)]"
          style={{ color: "var(--fg-dim)" }}
        >
          open Context.md →
        </Link>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        <Section
          title={t("inbox.section.new")}
          items={building.new}
          accent="var(--success)"
        />
        <Section
          title={t("inbox.section.decide")}
          items={building.decide}
          accent="var(--warning)"
        />
        <Section
          title={t("inbox.section.changed")}
          items={building.changed}
          accent="var(--fg-dim)"
        />
      </div>
    </article>
  );
}

function Section({
  title,
  items,
  accent,
}: {
  title: string;
  items: DigestItem[];
  accent: string;
}) {
  const { t } = useLocale();
  return (
    <section
      className="rounded-lg border p-5"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-elevated)",
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: accent }}
        />
        <h3
          className="text-[12px] font-mono uppercase tracking-wider"
          style={{ color: "var(--fg-muted)" }}
        >
          {title}
        </h3>
        <span
          className="ml-auto text-[11px] font-mono"
          style={{ color: "var(--fg-dim)" }}
        >
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--fg-dim)" }}>
          {t("common.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((it, i) => (
            <li key={i} className="text-[13px] leading-snug">
              <div className="flex items-baseline gap-2">
                <span
                  className="font-mono text-[11px] shrink-0"
                  style={{ color: "var(--fg-dim)" }}
                >
                  {it.predicate}
                </span>
                <span style={{ color: "var(--fg)" }}>{it.value}</span>
              </div>
              <div
                className="mt-0.5 font-mono text-[11px]"
                style={{ color: "var(--fg-dim)" }}
              >
                {it.source} · {it.when}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Placeholder digest — live data comes from FR-7 action log in Phase 3.
const demoBuilding: Building = {
  id: "property:berliner-str-42",
  name: "Berliner Str. 42 · Mitte",
  new: [
    {
      predicate: "tenancy.rent.next",
      value: "€1,800 / mo from 2026-06-01",
      source: "email:landlord@müller.de",
      when: "2026-04-18",
      kind: "added",
    },
    {
      predicate: "condition.open_tickets",
      value: "1 open",
      source: "zendesk:T-2210",
      when: "2026-04-22",
      kind: "added",
    },
  ],
  decide: [
    {
      predicate: "tenancy.rent.next",
      value: "€1,650 contested vs €1,800",
      source: "legal-memo-2026.pdf",
      when: "2026-04-20",
      kind: "conflict",
    },
  ],
  changed: [
    {
      predicate: "contact.manager",
      value: "Schneider → Hoffmann",
      source: "erp:contacts#b-4412",
      when: "2026-04-15",
      kind: "superseded",
    },
  ],
};
