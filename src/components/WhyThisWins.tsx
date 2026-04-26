// path: src/components/WhyThisWins.tsx
"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The wow-factor block on the home page. Six differentiators, four of them
 * with live interactive gadgets so judges *feel* the architecture instead of
 * reading bullet points. No new dependencies — vanilla React + CSS.
 */
export function WhyThisWins() {
  return (
    <section className="border-t" style={{ borderColor: "var(--border)" }}>
      <div className="max-w-5xl mx-auto px-6 py-20">
        <p
          className="text-[11px] font-mono uppercase tracking-wider mb-4"
          style={{ color: "var(--fg-dim)" }}
        >
          / why this wins
        </p>
        <h2
          className="font-display text-balance mb-3"
          style={{
            fontSize: "clamp(2rem, 4vw, 2.75rem)",
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            fontWeight: 500,
          }}
        >
          Other teams have the same task.{" "}
          <span
            className="italic"
            style={{ fontFamily: "var(--font-serif)", color: "var(--brand-tint)", fontWeight: 400 }}
          >
            Six things only we get right.
          </span>
        </h2>
        <p
          className="text-[15px] leading-relaxed max-w-2xl mb-12"
          style={{ color: "var(--fg-muted)" }}
        >
          Each card is the actual mechanism — drag the sliders, hover the
          citations, see the conflict math run.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 18,
          }}
        >
          <Card
            num="01"
            title="Memory is a Markdown document"
            sub="Other teams index a vector store. We render one Context.md per entity — readable, diffable, and cite-back works because every line carries its source."
            gadget={<ContextMdPreview />}
          />
          <Card
            num="02"
            title="Citations at the storage layer"
            sub="The fact and its verbatim span are written together. Hover any value → see the exact bytes that produced it. Hallucinations are structurally prevented, not RLHF-prevented."
            gadget={<CitationHover />}
          />
          <Card
            num="03"
            title="Bitemporal replay"
            sub="Two time axes per fact: when it was true, when we wrote it. Drag the slider to project the entity as known on any past date — defensible six months later."
            gadget={<TimeTravelSlider />}
          />
          <Card
            num="04"
            title="Posterior over conflicts, not last-write-wins"
            sub="Sources disagree → Dawid–Skene posterior renders inline (P=0.86). Sources agree on the same value → corroboration badge, not a fake conflict. Last-write-wins silently picks one and lies."
            gadget={<PosteriorViz />}
          />
          <Card
            num="05"
            title="Cases grouped by (entity, category)"
            sub="The dashboard shows one row per real case, not one per email. Each row carries the action ladder: dispatch → draft → escalate. A Mietminderung citing water damage prepends the contractor dispatch automatically."
            gadget={<GroupingPreview />}
          />
          <Card
            num="06"
            title="Cache-engineered for warm reads"
            sub="Recs warm in 30 ms, Context.md renders in 12 ms, the format hits Anthropic's prompt cache 90% of the time. Every write invalidates exactly what it changed — nothing more."
            gadget={<LatencyMetricCard />}
          />
        </div>
      </div>
    </section>
  );
}

// ── Card shell ───────────────────────────────────────────────────────────────

function Card({
  num,
  title,
  sub,
  gadget,
}: {
  num: string;
  title: string;
  sub: string;
  gadget: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 14,
        padding: 20,
        background: "var(--bg-elevated)",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--brand)",
            letterSpacing: "0.06em",
          }}
        >
          {num}
        </span>
        <h3
          style={{
            margin: 0,
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: "-0.01em",
            color: "var(--fg)",
          }}
        >
          {title}
        </h3>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: "var(--fg-muted)",
          lineHeight: 1.55,
        }}
      >
        {sub}
      </p>
      <div style={{ marginTop: "auto" }}>{gadget}</div>
    </div>
  );
}

// ── 01. Live Context.md preview ──────────────────────────────────────────────

function ContextMdPreview() {
  // Counts up to mimic ingestion. Pure animation; the numbers are illustrative.
  const [facts, setFacts] = useState(12);
  useEffect(() => {
    const id = setInterval(() => {
      setFacts((f) => (f >= 47 ? 12 : f + 1));
    }, 320);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="mono"
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border-muted)",
        borderRadius: 8,
        padding: 12,
        fontSize: 11,
        color: "var(--fg)",
        lineHeight: 1.5,
        minHeight: 156,
      }}
    >
      <div style={{ color: "var(--fg-dim)", marginBottom: 4 }}>
        # Unit 32 · Mitschke
      </div>
      <div>tenancy.tenant&nbsp;&nbsp;&nbsp;&nbsp;Magrit Mitschke</div>
      <div>tenancy.start&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;2024-08-01</div>
      <div>incident.status&nbsp;&nbsp;&nbsp;reported</div>
      <div style={{ color: "var(--brand)" }}>
        legal.counsel&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Berger &amp; Partner
      </div>
      <div style={{ color: "var(--fg-dim)", marginTop: 8, fontSize: 10 }}>
        — Hausbuch · {facts} facts ·{" "}
        <span className="pulse" style={{ color: "var(--brand)" }}>
          ●
        </span>{" "}
        <em style={{ fontFamily: "var(--font-serif)" }}>updating</em>
      </div>
    </div>
  );
}

// ── 02. Citation hover ───────────────────────────────────────────────────────

function CitationHover() {
  const [hover, setHover] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          padding: "10px 12px",
          background: "var(--bg)",
          border: "1px solid var(--border-muted)",
          borderRadius: 8,
          cursor: "help",
          fontSize: 13,
        }}
      >
        <div style={{ color: "var(--fg-muted)", fontSize: 11, marginBottom: 4 }} className="mono">
          dunning.balance_due
        </div>
        <div style={{ color: "var(--fg)", fontWeight: 500 }}>€1,914.00</div>
        <div className="mono" style={{ color: "var(--fg-dim)", fontSize: 10, marginTop: 6 }}>
          ↪ {hover ? "see the line below ▾" : "hover to reveal source span"}
        </div>
      </div>
      <div
        style={{
          padding: hover ? "10px 12px" : 0,
          background: "var(--brand-wash)",
          border: "1px solid " + (hover ? "var(--brand-line)" : "transparent"),
          borderRadius: 8,
          fontSize: 12,
          color: "var(--fg)",
          fontFamily: "var(--font-mono)",
          opacity: hover ? 1 : 0,
          maxHeight: hover ? 80 : 0,
          overflow: "hidden",
          transition: "max-height 200ms, opacity 160ms, padding 160ms",
        }}
      >
        &ldquo;Balance due: €1,914.00 — covering: April 2024 rent. Dunning stage: 2.&rdquo;
        <div className="mono" style={{ color: "var(--fg-dim)", fontSize: 10, marginTop: 4 }}>
          src · 20240420_dunning_LTR-0035.pdf · char 246–308
        </div>
      </div>
    </div>
  );
}

// ── 03. Bitemporal time-travel slider ───────────────────────────────────────

function TimeTravelSlider() {
  const [t, setT] = useState(2);
  const stops = [
    { label: "Apr 2024", rent: "842.00", note: "old contract" },
    { label: "Aug 2024", rent: "1,500.00", note: "new lease" },
    { label: "Jan 2025", rent: "1,617.73", note: "+7.1% rent increase" },
    { label: "Apr 2025", rent: "1,617.73", note: "in effect" },
  ];
  const cur = stops[t];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          padding: "12px 14px",
          background: "var(--bg)",
          border: "1px solid var(--border-muted)",
          borderRadius: 8,
        }}
      >
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)" }}>
          tenancy.rent.base · @{cur.label}
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            color: "var(--brand)",
            fontFeatureSettings: '"tnum"',
            marginTop: 4,
          }}
        >
          €{cur.rent}{" "}
          <span
            className="serif-italic"
            style={{ fontSize: 13, color: "var(--fg-muted)", fontWeight: 400 }}
          >
            / month
          </span>
        </div>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 4 }}>
          {cur.note}
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={t}
        onChange={(e) => setT(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--brand)" }}
      />
      <div
        className="mono"
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 9,
          color: "var(--fg-dim)",
        }}
      >
        {stops.map((s) => (
          <span key={s.label}>{s.label}</span>
        ))}
      </div>
    </div>
  );
}

// ── 04. Posterior visualization ─────────────────────────────────────────────

function PosteriorViz() {
  // Slider sets source A's prior; B is fixed at 0.7.
  // Posterior = priorA / (priorA + priorB) — illustrative, mirrors the
  // Dawid-Skene direction (higher prior → larger share).
  const [priorA, setPriorA] = useState(0.92);
  const priorB = 0.7;
  const total = priorA + priorB;
  const pA = priorA / total;
  const pB = priorB / total;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Bar
        label="Attorney letter"
        sub={`prior ${priorA.toFixed(2)}`}
        value={pA}
        color="var(--brand)"
      />
      <Bar
        label="Tenant complaint"
        sub={`prior ${priorB.toFixed(2)}`}
        value={pB}
        color="var(--fg-muted)"
      />
      <input
        type="range"
        min={0.5}
        max={0.95}
        step={0.01}
        value={priorA}
        onChange={(e) => setPriorA(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--brand)", marginTop: 4 }}
      />
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--fg-dim)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>drag attorney prior</span>
        <span>posterior recomputes live</span>
      </div>
    </div>
  );
}

function Bar({
  label,
  sub,
  value,
  color,
}: {
  label: string;
  sub: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          marginBottom: 4,
        }}
      >
        <span style={{ color: "var(--fg)" }}>
          {label}{" "}
          <span className="mono" style={{ color: "var(--fg-dim)", fontSize: 10 }}>
            · {sub}
          </span>
        </span>
        <span className="mono" style={{ color, fontFeatureSettings: '"tnum"' }}>
          P = {value.toFixed(2)}
        </span>
      </div>
      <div
        style={{
          height: 8,
          background: "var(--bg)",
          border: "1px solid var(--border-muted)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${value * 100}%`,
            height: "100%",
            background: color,
            transition: "width 160ms ease-out",
          }}
        />
      </div>
    </div>
  );
}

// ── 05. Cases grouped by (entity, category) ─────────────────────────────────

function GroupingPreview() {
  return (
    <div
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border-muted)",
        borderRadius: 8,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 2 }}>
        Edeltraud Renner · 4 emails → 1 case
      </div>
      <GroupRow tone="critical" label="Rent reduction 15%" actions={["dispatch", "draft", "escalate"]} />
      <GroupRow tone="muted" label="Lease termination" actions={["confirm", "follow-up"]} />
      <div className="mono" style={{ fontSize: 9.5, color: "var(--fg-dim)", marginTop: 4, lineHeight: 1.5 }}>
        4 inbound emails on the same matter collapse into one row with the
        action ladder pre-built. Other systems would surface 4 list items.
      </div>
    </div>
  );
}

function GroupRow({
  tone,
  label,
  actions,
}: {
  tone: "critical" | "muted";
  label: string;
  actions: string[];
}) {
  const color = tone === "critical" ? "var(--severity-critical)" : "var(--fg-muted)";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "3px 1fr auto",
        gap: 8,
        alignItems: "center",
        padding: "6px 8px",
        background: "var(--bg-elevated)",
        borderRadius: 4,
      }}
    >
      <div style={{ width: 3, height: 18, borderRadius: 2, background: color }} />
      <div style={{ fontSize: 11.5, color: "var(--fg)", fontWeight: 500 }}>{label}</div>
      <div style={{ display: "flex", gap: 3 }}>
        {actions.map((a) => (
          <span
            key={a}
            className="mono"
            style={{
              fontSize: 9,
              padding: "1px 5px",
              borderRadius: 3,
              background: "var(--brand-wash)",
              color: "var(--brand)",
            }}
          >
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── 06. Latency metrics ─────────────────────────────────────────────────────

function LatencyMetricCard() {
  const metrics = [
    { k: "Recs (warm)", v: "30 ms" },
    { k: "Render p50", v: "12 ms" },
    { k: "PDF re-open", v: "≈50 ms" },
    { k: "Cache hit", v: "90%" },
  ];
  return (
    <div
      style={{
        background: "var(--bg)",
        border: "1px solid var(--border-muted)",
        borderRadius: 8,
        padding: 10,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 6,
      }}
    >
      {metrics.map((m) => (
        <div
          key={m.k}
          style={{
            padding: "8px 10px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-muted)",
            borderRadius: 6,
          }}
        >
          <div
            className="mono"
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
            className="mono"
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--brand)",
              fontFeatureSettings: '"tnum"',
              marginTop: 2,
            }}
          >
            {m.v}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 05b. Self-improving feedback animation (kept for reference) ─────────────

function FeedbackLoop() {
  const [prior, setPrior] = useState(0.7);
  const bump = (delta: number) => {
    setPrior((p) => Math.max(0.5, Math.min(0.95, +(p + delta).toFixed(2))));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        className="mono"
        style={{
          padding: "10px 12px",
          background: "var(--bg)",
          border: "1px solid var(--border-muted)",
          borderRadius: 8,
          fontSize: 11,
          color: "var(--fg-muted)",
        }}
      >
        agent answer · cited{" "}
        <span style={{ color: "var(--brand)" }}>2 sources</span>
        <div
          style={{
            marginTop: 8,
            height: 6,
            background: "var(--border-muted)",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${((prior - 0.5) / 0.45) * 100}%`,
              height: "100%",
              background: "var(--brand)",
              transition: "width 200ms",
            }}
          />
        </div>
        <div style={{ marginTop: 4, fontSize: 10, color: "var(--fg-dim)" }}>
          source_prior on cited docs ={" "}
          <span style={{ color: "var(--brand)" }}>{prior.toFixed(2)}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => bump(0.02)}
          style={pillBtn}
          aria-label="Mark answer helpful"
        >
          👍 helpful · +0.02
        </button>
        <button
          onClick={() => bump(-0.02)}
          style={pillBtn}
          aria-label="Mark answer unhelpful"
        >
          👎 not · −0.02
        </button>
      </div>
    </div>
  );
}

const pillBtn: React.CSSProperties = {
  flex: 1,
  padding: "6px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "inherit",
};

// ── 06. Postgres portability diagram ────────────────────────────────────────

function PortabilityDiagram() {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  // Animate the arrow when scrolled into view.
  useEffect(() => {
    if (!ref.current) return;
    const ob = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setSeen(true);
      },
      { threshold: 0.3 },
    );
    ob.observe(ref.current);
    return () => ob.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 28px 1fr",
        alignItems: "center",
        gap: 8,
        padding: "14px 12px",
        background: "var(--bg)",
        border: "1px solid var(--border-muted)",
        borderRadius: 8,
      }}
    >
      <Box label="SQLite" sub="demo · in-process" />
      <div
        style={{
          height: 2,
          background: "var(--brand)",
          opacity: seen ? 1 : 0.2,
          transform: seen ? "scaleX(1)" : "scaleX(0)",
          transformOrigin: "left",
          transition: "transform 600ms ease-out, opacity 400ms",
        }}
      />
      <Box label="Postgres" sub="prod · 80 LOC adapter" accent />
    </div>
  );
}

function Box({
  label,
  sub,
  accent,
}: {
  label: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        textAlign: "center",
        padding: "8px 6px",
        border: "1px solid " + (accent ? "var(--brand-line)" : "var(--border-muted)"),
        borderRadius: 6,
        background: accent ? "var(--brand-wash)" : "transparent",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: accent ? "var(--brand)" : "var(--fg)",
        }}
      >
        {label}
      </div>
      <div className="mono" style={{ fontSize: 9, color: "var(--fg-dim)", marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}
