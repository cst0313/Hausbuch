// path: src/app/inbox/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { useLocale } from "@/components/LocaleProvider";

type Fact = {
  id: string;
  predicate: string;
  value: string | number | boolean | null;
  source: string;
  known_from: string;
  valid_from?: string | null;
};

type Source = { id: string; title: string; kind: string };

type DigestItem = {
  fact: Fact;
  source: Source | null;
  kind: "added" | "superseded" | "conflict";
  partnerPredicate?: string;
};

type Digest = {
  entity: string;
  since: string;
  new: DigestItem[];
  decide: DigestItem[];
  changed: DigestItem[];
};

type Building = {
  entity: string;
  name: string;
  digest: Digest;
};

// Known entities today: just the seed. Multi-building expansion lands when
// listEntities() grows beyond one property in Phase 2.
const KNOWN_ENTITIES = ["property:berliner-str-42"];

export default function InboxPage() {
  const { t } = useLocale();
  const [buildings, setBuildings] = useState<Building[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const DAYS = 365; // for the demo, surface everything in the last year
    Promise.all(
      KNOWN_ENTITIES.map(async (entity) => {
        const [digestRes, ctxRes] = await Promise.all([
          fetch(`/api/digest/${encodeURIComponent(entity)}?days=${DAYS}`).then(
            (r) => r.json() as Promise<Digest>,
          ),
          fetch(
            `/api/context/${encodeURIComponent(entity)}?format=json&detail=3`,
          ).then((r) => r.json()),
        ]);
        const addr = ctxRes.facts?.find(
          (f: Fact) => f.predicate === "identity.address",
        );
        return {
          entity,
          name: addr ? String(addr.value) : entity,
          digest: digestRes,
        } as Building;
      }),
    )
      .then((bs) => {
        if (!cancelled) setBuildings(bs);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
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

        {error && (
          <p
            className="text-[13px] font-mono"
            style={{ color: "var(--danger)" }}
          >
            {t("common.error")}: {error}
          </p>
        )}

        {buildings === null && !error && (
          <p style={{ color: "var(--fg-muted)" }}>{t("common.loading")}</p>
        )}

        {buildings?.length === 0 && (
          <p style={{ color: "var(--fg-muted)" }}>{t("common.empty")}</p>
        )}

        <div className="space-y-16">
          {buildings?.map((b) => <BuildingDigestBlock key={b.entity} building={b} />)}
        </div>
      </main>
    </>
  );
}

function BuildingDigestBlock({ building }: { building: Building }) {
  const { t } = useLocale();
  const id = building.entity.replace(/^property:/, "");
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
          href={`/context/${id}`}
          className="text-[12px] font-mono transition-colors hover:text-[color:var(--fg)]"
          style={{ color: "var(--fg-dim)" }}
        >
          open Context.md →
        </Link>
      </div>

      <div className="grid gap-8 md:grid-cols-3">
        <Section
          title={t("inbox.section.new")}
          items={building.digest.new}
          accent="var(--success)"
        />
        <Section
          title={t("inbox.section.decide")}
          items={building.digest.decide}
          accent="var(--warning)"
        />
        <Section
          title={t("inbox.section.changed")}
          items={building.digest.changed}
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
          aria-hidden
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
                  {it.fact.predicate}
                </span>
                <span style={{ color: "var(--fg)" }}>
                  {it.kind === "conflict" && it.partnerPredicate
                    ? it.partnerPredicate
                    : String(it.fact.value)}
                </span>
              </div>
              <div
                className="mt-0.5 font-mono text-[11px]"
                style={{ color: "var(--fg-dim)" }}
              >
                {it.source?.title ?? it.fact.source} · {shortDate(it.fact.known_from)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
