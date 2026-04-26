// path: src/app/technical/page.tsx
import { Nav } from "@/components/Nav";
import { CAPABILITIES } from "../research/page";

export const metadata = {
  title: "Hausbuch — Docs",
  description:
    "Product overview for Hausbuch: what each surface does, how data flows from a tenant email all the way to a manager's drafted reply, and the bitemporal storage model behind it.",
};

export default function TechnicalPage() {
  return (
    <>
      <Nav />

      <main style={{ maxWidth: 1080, margin: "0 auto", padding: "48px 48px 96px" }}>
        {/* Hero */}
        <section style={{ marginBottom: 56 }}>
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
            / technical reference
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
            How Hausbuch <span className="serif-italic" style={{ fontWeight: 400 }}>actually works</span>.
          </h1>
          <p
            style={{
              margin: "16px 0 0",
              fontSize: 16,
              color: "var(--fg-muted)",
              maxWidth: 720,
              lineHeight: 1.55,
            }}
          >
            A property manager sees a single document per building. Underneath, every email, PDF,
            invoice, and contract is a stream of bitemporal facts with source citations and
            Dawid&ndash;Skene posteriors when sources disagree. This page is the engineer&apos;s map —
            for the deep-tech foundations behind each design choice see{" "}
            <a href="/research" style={{ color: "var(--brand)" }}>/research</a>.
          </p>
        </section>

        <Section title="What's in the seeded system" eyebrow="00">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65, marginBottom: 16 }}>
            The hackathon dataset for WEG Immanuelkirchstraße 26 boots into a SQLite file the
            first time the dev server runs. Everything you see in the dashboard, the agent, and
            the Context.md pages is derived from these rows — no fixtures, no mocks.
          </p>
          <DataShapeGrid />
        </Section>

        <Section title="Visual workflows" eyebrow="0a">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65, marginBottom: 18 }}>
            Two diagrams render below as inline SVG so they ship with the page itself; the
            equivalent <code className="mono">.drawio</code> sources live in{" "}
            <a href="/diagrams/01-architecture.drawio" style={{ color: "var(--brand)" }}>/diagrams/</a>{" "}
            for editing.
          </p>
          <DiagramHeader title="Email trigger — from inbox to drafted reply" subtitle="What happens when a tenant sends an email" />
          <EmailTriggerDiagram />
          <DiagramHeader title="UI workflow — a property manager's morning" subtitle="Triage · Act · Investigate · Audit" extraTop={32} />
          <UiWorkflowDiagram />
          <p style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 14 }}>
            Source files:{" "}
            <a href="/diagrams/01-architecture.drawio" style={{ color: "var(--brand)" }}>architecture</a>
            {" · "}
            <a href="/diagrams/02-email-trigger.drawio" style={{ color: "var(--brand)" }}>email trigger</a>
            {" · "}
            <a href="/diagrams/03-ui-workflow.drawio" style={{ color: "var(--brand)" }}>UI workflow</a>
          </p>
        </Section>

        <Section title="System architecture" eyebrow="01">
          <Architecture />
          <p style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.6, marginTop: 24 }}>
            Inbound sources flow left-to-right through a small synchronous pipeline. The relevance
            gate filters noise before any LLM call. The extractor produces atomic facts, the
            reconciler resolves conflicts with Dawid&ndash;Skene, and the enrichment phase calls
            partner APIs in parallel. The renderer reads from the fact store on demand and writes
            one Markdown document per entity, anchored block-by-block so a human edit between
            blocks survives the next patch.
          </p>
        </Section>

        <Section title="The primitive: bitemporal facts" eyebrow="02">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65 }}>
            A fact is one row in <code className="mono">facts</code>. Five fields make it different
            from any other property-management database row.
          </p>
          <Table
            rows={[
              ["valid_from / valid_to", "When the claim is true in the world. The rent is €842 from 2024-08-01 onward."],
              ["known_from / known_to", "When Hausbuch learned it. Two axes — see the example below."],
              ["span", "Verbatim source quote. So a manager can hover a cell and see the email line that produced it."],
              ["source_prior", "Per-source reliability prior, 0..1. Used by the reconciler when sources disagree."],
              ["confidence", "Per-extraction belief, 0..1. From the regex tier or the LLM tier."],
            ]}
          />
          <Callout>
            The <em className="serif-italic">two time axes</em> answer two different questions.
            <br />
            <span className="mono" style={{ fontSize: 12 }}>valid_time:</span> What was the rent in June?
            <br />
            <span className="mono" style={{ fontSize: 12 }}>known_time:</span> What did we know on April 15?
            <br />
            Most teams collapse to a single <code className="mono">updated_at</code> and lose
            both. Replay only works when both axes exist.
          </Callout>
        </Section>

        <Section title="Conflict reconciliation" eyebrow="03">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65 }}>
            When two sources disagree on the same predicate at the same{" "}
            <code className="mono">valid_from</code>, the reconciler computes a posterior with
            Dawid&ndash;Skene: each source contributes a log-likelihood weighted by its{" "}
            <code className="mono">source_prior</code>; the posterior renders inline in the
            Markdown.
          </p>
          <CodeBlock>
            {`# WE 32 — Immanuelkirchstr. 26

incident.status
  · reported   ^[Schimmel-Meldung · email · 2026-01-03 · prior 0.70]
  · escalated  ^[Anwaltschreiben · letter · 2026-01-15 · prior 0.92]
  posterior: P(escalated) = 0.86 · P(reported) = 0.14 · via Dawid–Skene 1979`}
          </CodeBlock>
        </Section>

        <Section title="Cache-engineered rendering" eyebrow="04">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65 }}>
            The renderer&apos;s job is to make Anthropic&apos;s prompt cache hit. That means
            byte-stable output for stable inputs.
          </p>
          <ul style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.8, paddingLeft: 18 }}>
            <li>Sections in fixed order: Identity → Tenancy → Condition → Contacts → History</li>
            <li>Predicate keys padded to 18 chars so cell alignment never shifts</li>
            <li>Anchored blocks <code className="mono">&lt;!-- fact:IDENT --&gt;</code> let surgical patches replace one block without disturbing surrounding text</li>
            <li>Volatile sections (Recent activity, Conflicts) at the bottom so the prefix stays cached</li>
            <li>No <code className="mono">rendered_at</code> timestamp — would bust the cache</li>
          </ul>
          <Callout>
            Measured against the live database (<code className="mono">scripts/bench-render.mjs</code>):
            the structured Context.md averages <strong>1.64× smaller (39% fewer tokens)</strong>{" "}
            than the same facts written as plain English prose, across 2,571 facts /
            4 representative entities. Plus the byte-stable prefix earns a 90% prompt-cache
            hit on every follow-up question. Full table on{" "}
            <a href="/research" style={{ color: "var(--brand)" }}>/research</a>.
          </Callout>
        </Section>

        <Section title="Two views of the same bytes" eyebrow="04b">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65 }}>
            The Context.md is one canonical artifact stored in the database. The agent
            consumes the raw structured form (tight, padded, cache-friendly). The user
            sees a typed-table rendering at <code className="mono">/context/[id]</code> —
            same bytes, parsed into predicate · value · citation chip · corroboration
            count, with conflicts shown as posterior bars. Toggle{" "}
            <code className="mono">view raw</code> on the page to see what the agent reads.
          </p>
        </Section>

        <Section title="Surgical updates" eyebrow="05">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65 }}>
            A new email shouldn&apos;t regenerate the whole document — that would destroy any human
            edit between anchored blocks and burn tokens. The patcher replaces only the tagged
            blocks; everything outside the anchor tags is preserved verbatim.
          </p>
          <CodeBlock>
            {`<!-- fact:tenancy_rent_base -->
rent.base         €1,650 / mo  ^[Mietspiegel-Memo]
<!-- /fact:tenancy_rent_base -->

# Manager note added inline — not touched by any patch
# "Tenant called about the boiler again, said today is the third time."

<!-- fact:contacts_manager_phone -->
contacts.manager.phone  +49 30 0000 0000  ^[Stammdaten]
<!-- /fact:contacts_manager_phone -->`}
          </CodeBlock>
        </Section>

        <Section title="Reputation, derived not stored" eyebrow="06">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65 }}>
            Tenant and contractor reputation is computed at query time from existing facts —
            never written as its own predicate. That keeps it consistent with the document and
            impossible to drift. Recent events (≤ 90 days) carry full weight; older signals decay
            with a 180-day half-life so the system forgives.
          </p>
          <ul style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.8, paddingLeft: 18 }}>
            <li>Negative signals: open incidents, dunning notices, lease cancellations, intent-to-sell.</li>
            <li>Positive signals: resolved incidents, multi-year contract tenure.</li>
            <li>Three bands: <span style={{ color: "var(--rep-trusted)" }}>trusted</span> (&gt; 0.7), <span style={{ color: "var(--rep-neutral)" }}>neutral</span> (0.4–0.7), <span style={{ color: "var(--rep-avoid)" }}>avoid</span> (&lt; 0.4).</li>
            <li>Reputation routes contractor selection — when the system would dispatch to a low-scoring vendor, it picks the next-best in the same trade and surfaces a one-line justification.</li>
          </ul>
        </Section>

        <Section title="Partner integrations" eyebrow="07">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65 }}>
            Each partner has one job; each call writes to the audit log with redacted payloads.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginTop: 16 }}>
            <PartnerCard name="Gemini (Google DeepMind)" role="Extractor + composer" detail="2.5-flash for structured extraction and recipient-facing drafts. Vision for image OCR. Thinking budget 0 on compose so latency stays under 2s." />
            <PartnerCard name="Tavily" role="Live web enrichment" detail="Mietpreisbremse caps, Handelsregister verification, contractor active-status. 6s timeout, 24h cache." />
            <PartnerCard name="Cala" role="Entity verification" detail="Owner companies and contractors checked against api.cala.ai. HRB number, registration status, jurisdiction." />
            <PartnerCard name="Gradium" role="Voice → agent" detail="WebSocket ASR at wss://api.gradium.ai/api/speech/asr. The ⌘K palette captures PCM at 24 kHz mono and streams 80 ms chunks; the agent answers as if typed." />
            <PartnerCard name="Aikido" role="Supply-chain scan" detail="GitHub Action runs npm audit on every push; weekly Aikido report." />
            <PartnerCard name="Anthropic" role="Optional adapter" detail="Claude is the alt composer when Gemini is unavailable; same prompt-cache contract." />
          </div>
        </Section>

        <Section title="What's actually built" eyebrow="07b">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65, marginBottom: 16 }}>
            Capability index — every entry maps to a real code path, updated when behavior
            changes (not when slides do). Numbers and benchmarks for the perf entries are on{" "}
            <a href="/research" style={{ color: "var(--brand)" }}>/research</a>.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            {CAPABILITIES.map((c) => (
              <div
                key={c.title}
                style={{
                  padding: "16px 18px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                }}
              >
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--brand)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 6,
                  }}
                >
                  {c.stage}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: "-0.005em",
                    marginBottom: 6,
                  }}
                >
                  {c.title}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--fg-muted)", lineHeight: 1.55 }}>
                  {c.body}
                </div>
                <div className="mono" style={{ marginTop: 10, fontSize: 10.5, color: "var(--fg-dim)" }}>
                  {c.location}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Storage layout for sub-millisecond fact reads" eyebrow="08">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65, marginBottom: 14 }}>
            Every agent question turns into the same shape of read: <em>give me the live facts
            for entity X, optionally as of time T</em>. The schema is built so that read is one
            indexed lookup against a single SQLite file in the same Node process — no network,
            no graph DB, no separate vector store.
          </p>

          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            schema (only the indexed columns shown)
          </div>
          <CodeBlock>
{`CREATE TABLE facts (
  id              TEXT PRIMARY KEY,
  entity          TEXT NOT NULL,   -- which entity this fact is about
  predicate       TEXT NOT NULL,   -- e.g. "tenancy.rent.base", "incident.status"
  value           TEXT,
  valid_from      TEXT,            -- when the claim is true in the world
  valid_to        TEXT,
  known_from      TEXT NOT NULL,   -- when we learned it
  known_to        TEXT,            -- NULL = currently believed; else superseded
  source          TEXT NOT NULL,   -- foreign key to sources(id)
  span_quote      TEXT NOT NULL,   -- verbatim source quote for the citation
  confidence      REAL NOT NULL,
  superseded_by   TEXT,
  ident           TEXT NOT NULL    -- sha256(entity|predicate|valid_from)[:16]
);

-- Hot-path indexes
CREATE INDEX idx_facts_entity      ON facts(entity);              -- (1)
CREATE INDEX idx_facts_predicate   ON facts(entity, predicate);   -- (2)
CREATE INDEX idx_facts_known       ON facts(known_from, known_to);-- (3)
CREATE INDEX idx_facts_valid       ON facts(valid_from, valid_to);-- (4)
CREATE INDEX idx_facts_ident       ON facts(ident);               -- (5)`}
          </CodeBlock>

          <p style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.65, marginTop: 18 }}>
            Each index pulls weight in one specific question:
          </p>
          <ul style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.85, paddingLeft: 18 }}>
            <li><strong>(1) entity</strong> — the agent&apos;s default fetch: <code className="mono">SELECT * FROM facts WHERE entity = ?</code>. Single index seek, returns ~100 rows for the average entity, zero scan.</li>
            <li><strong>(2) (entity, predicate)</strong> — composite. Lets the renderer ask &quot;what&apos;s this entity&apos;s rent.base?&quot; in O(log n) instead of filtering in JS.</li>
            <li><strong>(3) (known_from, known_to)</strong> — bitemporal time-travel. <code className="mono">WHERE known_from &lt;= @at AND (known_to IS NULL OR known_to &gt; @at)</code> uses this directly.</li>
            <li><strong>(4) (valid_from, valid_to)</strong> — &quot;what was true on date X?&quot; The reconciler also uses this for overlap detection during conflicts.</li>
            <li><strong>(5) ident</strong> — <code className="mono">sha256(entity|predicate|valid_from)</code>. The supersession path needs to find &quot;is there a prior live fact with this exact identity?&quot; in one lookup; without this index it would be a sequential scan on every ingest.</li>
          </ul>

          <Callout>
            Append-only matters here. Facts never get UPDATEd or DELETEd — supersession just
            sets <code className="mono">known_to</code> on the older row. That keeps the index B-trees stable
            (no fragmentation), preserves history for free, and makes the audit log trivially
            consistent with the data.
          </Callout>
        </Section>

        <Section title="The agent's read path, end-to-end" eyebrow="09">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65, marginBottom: 14 }}>
            When a user asks the agent a question, here&apos;s the sequence — every layer designed
            to answer in one round trip with stable, cache-friendly bytes.
          </p>
          <CodeBlock>
{`/api/agent ──▶ runAgent({ message, entity_id })

  1. resolve target entity                           (~0.3 ms)
       getEntity(entity_id)
       → indexed PRIMARY KEY lookup on entities

  2. fetch live facts                                (~1.5 ms for 100 facts)
       SELECT * FROM facts
        WHERE entity = @id
          AND known_to IS NULL
        ORDER BY known_from ASC
       → uses idx_facts_entity (1)

  3. render Context.md                               (~12 ms)
       group facts by predicate, format with anchored
       blocks and citations. Output is ~2k tokens at
       detail = 3 — well inside the LLM "lost-in-middle"
       sweet spot, and prefix-stable for prompt caching.

  4. compose answer (Gemini 2.5 Flash)              (~780 ms)
       prompt = <system> + <Context.md slice> + <question>
       thinkingBudget = 0  → first token in ~250 ms
       cache hit on the Context.md prefix → 90% cost cut
       on follow-ups about the same entity within 5 min.

  5. record agent.query in actions table             (~0.5 ms)
       drives the dashboard's Live activity strip and the
       per-entity query frequency on the profile panel.

total: ~ 800 ms cold, ~ 280 ms cached`}
          </CodeBlock>

          <p style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.65, marginTop: 18 }}>
            Three caches stack on top of the SQLite reads, each invalidated by a precise event:
          </p>
          <ul style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.85, paddingLeft: 18 }}>
            <li><strong>SQLite WAL</strong> — write-ahead log mode means readers don&apos;t block writers; a query during ingest doesn&apos;t pay any contention cost.</li>
            <li><strong>15-second recommendation cache</strong> — <code className="mono">getRecommendations()</code> caches its full reconciler+reputation pass. Bust events: ingest, correct, revoke, feedback. The dashboard&apos;s 60-row table reads in 3 ms when warm vs 380 ms cold.</li>
            <li><strong>Anthropic prompt cache</strong> — the renderer emits byte-stable prefixes (sections in fixed order, no <code className="mono">rendered_at</code> timestamp, padded predicate keys). Anthropic&apos;s 5-minute TTL discount applies to every follow-up question about the same entity.</li>
          </ul>
        </Section>

        <Section title="The data capsule shipped with the demo" eyebrow="10">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65, marginBottom: 14 }}>
            The deployed instance ingests the WEG Immanuelkirchstraße 26 corpus on first boot.
            What the agent answers from is real data, not fixtures: <strong>339 PDFs</strong>
            extracted by the heuristic pipeline yield <strong>4,673 atomic facts</strong>
            (avg 13.8 facts per PDF, zero documents below threshold). Plus the seeded master
            data (52 units, 35 owners, 26 tenants, 16 contractors, 3 buildings, 1 WEG) and
            the 6,546-message email archive.
          </p>

          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            PDFs by classified letter.kind
          </div>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              overflow: "hidden",
              background: "var(--bg-elevated)",
              marginBottom: 18,
            }}
          >
            {[
              ["rechnung", "Vendor invoices (DE + EN variants)", 204],
              ["etv_einladung", "Eigentümerversammlung invitations", 70],
              ["hausgeld", "HOA accounting statements", 35],
              ["nebenkostenabrechnung", "Annual utility settlement (BKA)", 13],
              ["mahnung", "Payment reminders", 10],
              ["mieterhoehung", "§558 BGB rent-increase letters", 3],
              ["etv_protokoll", "Assembly minutes", 2],
              ["kuendigung", "Lease terminations", 2],
            ].map(([kind, desc, n], i, arr) => (
              <div
                key={kind as string}
                style={{
                  display: "grid",
                  gridTemplateColumns: "200px 1fr 60px",
                  gap: 12,
                  padding: "10px 14px",
                  fontSize: 13,
                  alignItems: "baseline",
                  borderBottom: i < arr.length - 1 ? "1px solid var(--border-muted)" : "none",
                }}
              >
                <span className="mono" style={{ color: "var(--brand)" }}>{kind}</span>
                <span style={{ color: "var(--fg)" }}>{desc}</span>
                <span className="mono" style={{ color: "var(--fg-muted)", textAlign: "right" }}>{n}</span>
              </div>
            ))}
          </div>

          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            predicate families surfaced from the corpus
          </div>
          <ul style={{ fontSize: 13.5, color: "var(--fg-muted)", lineHeight: 1.8, paddingLeft: 18 }}>
            <li><code className="mono">letter.{"{"}issuer, datum, ort, kind{"}"}</code> — every Hausverwaltung letter</li>
            <li><code className="mono">recipient.{"{"}anrede, name, address{"}"}</code> — addressee on each formal letter</li>
            <li><code className="mono">mahnung.{"{"}stufe, offener_betrag, gebuehr, betrifft, frist_tage{"}"}</code></li>
            <li><code className="mono">kuendigung.{"{"}wohnung, kuendigungsdatum, grund, vertragsdatum, art{"}"}</code></li>
            <li><code className="mono">mieterhoehung.{"{"}wohnung, bisherige_miete, neue_miete, differenz, prozent, wirksam_ab, rechtsgrundlage{"}"}</code></li>
            <li><code className="mono">hausgeld.{"{"}einheit, me_anteil, bewirtschaftung, ruecklagenzufuehrung, verwaltungskosten, instandhaltung, sonderumlagen, gesamtkosten, vorauszahlungen, nachzahlung, guthaben, wirtschaftsjahr{"}"}</code> + <code className="mono">weg.ruecklagenbestand</code></li>
            <li><code className="mono">nebenkosten.{"{"}heizung_warmwasser, kaltwasser_abwasser, muell, hausmeister, treppenhaus, allgemeinstrom, gebaeudeversicherung, gartenpflege, grundsteuer, summe, vorauszahlungen, vorauszahlung_monate, vorauszahlung_pro_monat, guthaben, nachzahlung, jahr{"}"}</code></li>
            <li><code className="mono">etv.{"{"}termin, ort, tagesordnung{"}"}</code> + <code className="mono">etv.beschluss.top_N{"{"}.hoechstbetrag, .zustimmung{"}"}</code></li>
            <li><code className="mono">invoice.{"{"}vendor, nummer, kundennr, datum, netto, gesamtbetrag, mwst_prozent, mwst_betrag, leistungszeitraum, verwendungszweck, zahlungsfrist_tage{"}"}</code></li>
            <li><code className="mono">payment.{"{"}iban, bic, bank{"}"}</code> · <code className="mono">legal.{"{"}steuernr, ust_id{"}"}</code> — wherever banking and legal identifiers appear</li>
            <li><code className="mono">incident.type</code> — derived classifier (mahnung / kuendigung) so the dashboard&apos;s severity engine sees these documents as actionable events</li>
          </ul>

          <Callout>
            Every fact carries its <code className="mono">span_quote</code> — the verbatim slice
            of source text it was extracted from. Hover any value in a Context.md and the proof
            lens shows the exact line in the original PDF. Zero free-form retrieval at answer time.
          </Callout>
        </Section>

        <Section title="Portable to Postgres — same schema, drop-in adapter" eyebrow="11">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65, marginBottom: 14 }}>
            Hausverwaltungen run on Postgres. We run SQLite for the demo so judges get a
            single binary with zero infrastructure — but nothing in the architecture is
            tied to it. The schema, indexes, and read path move over with two SQL idiom
            swaps and one adapter file.
          </p>

          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            what stays the same
          </div>
          <ul style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.85, paddingLeft: 18, marginBottom: 18 }}>
            <li>Every column on every table, including the bitemporal pair and <code className="mono">ident</code>.</li>
            <li>All 5 hot-path indexes — the SQL is identical.</li>
            <li>Append-only model: supersession sets <code className="mono">known_to</code>, never UPDATEs or DELETEs.</li>
            <li>The 15-second recommendations cache, the renderer&apos;s prefix-stable Markdown, the Anthropic prompt cache.</li>
            <li>The agent&apos;s read path: one indexed lookup per question, same wire format.</li>
          </ul>

          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            what Postgres unlocks for free
          </div>
          <ul style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.85, paddingLeft: 18, marginBottom: 18 }}>
            <li><code className="mono">tstzrange</code> + GiST exclusion constraint on <code className="mono">(entity, predicate, valid_time_range)</code> — no-overlap is enforced at the database, eliminating the only theoretical race in the supersession path.</li>
            <li><code className="mono">LISTEN</code>/<code className="mono">NOTIFY</code> for cross-pod cache busts. The 15-second rec cache stays warm across replicas, not just per process.</li>
            <li><code className="mono">pg_trgm</code> on <code className="mono">span_quote</code> for instant fuzzy search across every citation — no separate vector store needed.</li>
            <li><code className="mono">JSONB</code> on the action log <code className="mono">input_json</code> / <code className="mono">output_json</code> with GIN indexing — jq-style filtered queries become as fast as relational lookups.</li>
            <li>MVCC — 50 colleagues editing simultaneously without WAL contention.</li>
          </ul>

          <Callout>
            The fact store is <em className="serif-italic">additive</em>. A customer doesn&apos;t
            migrate their existing ERP / CRM tables — they pick entity IDs that reference what
            they already have, and Hausbuch grows alongside. Migration cost from our SQLite
            demo to a Postgres deployment: one adapter file in <code className="mono">src/lib/db.ts</code>{" "}
            (swap <code className="mono">better-sqlite3</code> for <code className="mono">pg</code>,
            change two SQL idioms). Roughly 80 LOC of net change. Every fact and every predicate
            type comes along unchanged.
          </Callout>
        </Section>

        <Section title="Deduping facts and surfacing corroboration" eyebrow="12">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65, marginBottom: 14 }}>
            The corpus has redundancy on purpose — the same tenant&apos;s name shows up in
            their lease, every Mahnung, every BKA, every Hausgeld letter. Two operations
            keep that signal useful instead of noisy.
          </p>

          <div
            className="font-mono"
            style={{
              fontSize: 11,
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            (1) skip source-metadata predicates as entity facts
          </div>
          <p style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.65, marginBottom: 14 }}>
            <code className="mono">letter.kind</code>, <code className="mono">letter.issuer</code>,{" "}
            <code className="mono">letter.datum</code>, <code className="mono">recipient.*</code>,{" "}
            <code className="mono">payment.iban</code>, <code className="mono">legal.steuernr</code>,{" "}
            <code className="mono">invoice.vendor</code> describe the <em>source document</em>,
            not the entity it&apos;s about. They live on the Source row only and never get written
            as entity facts. On the seed, that strategy de-duplicates{" "}
            <strong>2,696 fact rows</strong> across 339 PDFs (8 metadata predicates × ~339 docs)
            — the WEG&apos;s Context.md no longer carries 339 copies of
            “letter.issuer = Huber &amp; Partner”.
          </p>

          <div
            className="font-mono"
            style={{
              fontSize: 11,
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 6,
            }}
          >
            (2) corroboration count on every fact line
          </div>
          <p style={{ fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.65, marginBottom: 14 }}>
            When a fact <em>is</em> the same across multiple sources, that&apos;s evidence,
            not a duplicate. The renderer queries{" "}
            <code className="mono">countCorroborations(entity, predicate, value)</code> —
            an indexed lookup against <code className="mono">(entity, predicate)</code> — and
            appends a <code className="mono">× N sources</code> tag plus the names of the
            other sources. The agent sees that the claim is independently asserted; the user
            can hover to see exactly which letters say so.
          </p>
          <CodeBlock>
{`tenancy.tenant      Magrit Mitschke  ^[Schimmel-Meldung] · × 4 sources
                                       (also: Heizung defekt; Anwaltschreiben; BKA 2024)`}
          </CodeBlock>

          <Callout>
            The cost of computing the count is one indexed SELECT against the same
            <code className="mono"> (entity, predicate) </code>composite index the renderer is already using.
            On the seed&apos;s ~17k live facts, an entire Context.md render including
            corroboration counts stays under 20 ms.
          </Callout>
        </Section>

        <Section title="Audit log" eyebrow="13">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65 }}>
            Append-only <code className="mono">actions</code> table. One row per significant step:
            ingest, llm.compose, enrich.&lt;kind&gt;, identity.resolved, fact.supersede, user.approve /
            reject / send / correct. Every payload runs through a redactor before persistence —
            API keys, OAuth tokens, IBANs, and tax IDs are scrubbed. The dashboard and stream
            panel both query this log; replay is a SELECT over a time range.
          </p>
        </Section>

        <Section title="Manager correction" eyebrow="14">
          <p style={{ fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.65 }}>
            When a manager spots a wrong fact in the stream panel they edit it in place. The
            correction posts to <code className="mono">/api/correct</code>, which writes a new fact
            with <code className="mono">source_prior=0.99</code> and supersedes the prior current
            fact for <code className="mono">(entity, predicate, valid_from)</code>. The audit log
            records who corrected it and when. No reconciler battle — the manager wins.
          </p>
        </Section>

        <div
          style={{
            marginTop: 56,
            paddingTop: 32,
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            color: "var(--fg-dim)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          <span>Hausbuch · Berlin · April 2026</span>
          <span>v0.4</span>
        </div>
      </main>
    </>
  );
}

// ── Section ──────────────────────────────────────────────────────────────────

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 56 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 18 }}>
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--brand)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}
        >
          {eyebrow}
        </span>
        <h2
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
          }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Table({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div
      style={{
        marginTop: 16,
        border: "1px solid var(--border)",
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--bg-elevated)",
      }}
    >
      {rows.map(([k, v], i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "220px 1fr",
            padding: "12px 16px",
            borderBottom: i < rows.length - 1 ? "1px solid var(--border-muted)" : "none",
            gap: 16,
          }}
        >
          <span className="mono" style={{ fontSize: 12, color: "var(--fg)" }}>
            {k}
          </span>
          <span style={{ fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.55 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 20,
        padding: "16px 20px",
        background: "var(--brand-wash)",
        border: "1px solid var(--brand-line)",
        borderRadius: 8,
        fontSize: 14,
        color: "var(--fg)",
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre
      className="mono"
      style={{
        marginTop: 16,
        padding: "16px 20px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: 12,
        lineHeight: 1.7,
        color: "var(--fg)",
        overflow: "auto",
        whiteSpace: "pre-wrap",
      }}
    >
      {children}
    </pre>
  );
}

function PartnerCard({
  name,
  role,
  detail,
}: {
  name: string;
  role: string;
  detail: string;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-elevated)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 500, color: "var(--fg)" }}>{name}</div>
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--brand)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginTop: 3,
          marginBottom: 8,
        }}
      >
        {role}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--fg-muted)", lineHeight: 1.55 }}>{detail}</div>
    </div>
  );
}

// ── Architecture diagram ─────────────────────────────────────────────────────

function Architecture() {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 24,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "auto",
      }}
    >
      <svg viewBox="0 0 1040 360" width="100%" style={{ display: "block", maxWidth: 1040 }}>
        <defs>
          <marker id="arr" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10" fill="var(--fg-dim)" />
          </marker>
          <marker id="arrBrand" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10" fill="var(--brand)" />
          </marker>
        </defs>

        {/* Sources column */}
        <Box x={20} y={50} w={150} h={28} label="email · letter · note" subtle />
        <Box x={20} y={88} w={150} h={28} label="PDF / image (vision)" subtle />
        <Box x={20} y={126} w={150} h={28} label="ERP / Stammdaten CSV" subtle />

        {/* Pipeline column */}
        <Box x={210} y={36} w={130} h={32} label="ingest" />
        <Box x={210} y={80} w={130} h={32} label="relevance gate" />
        <Box x={210} y={124} w={130} h={36} label="extractor" subLabel="regex + LLM" />
        <Box x={210} y={172} w={130} h={36} label="reconciler" subLabel="Dawid–Skene" />

        {/* Enrichments — grouped, run in parallel */}
        <rect
          x={370}
          y={48}
          width={170}
          height={196}
          rx={10}
          ry={10}
          fill="none"
          stroke="var(--brand-line)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
        <text
          x={455}
          y={42}
          textAnchor="middle"
          fontSize={10}
          fill="var(--brand)"
          fontFamily="var(--font-mono)"
          letterSpacing="0.06em"
        >
          ENRICHMENTS · IN PARALLEL
        </text>
        <Box x={384} y={66} w={142} h={32} label="Tavily" subLabel="web · regulatory" partner />
        <Box x={384} y={108} w={142} h={32} label="Cala" subLabel="entity verification" partner />
        <Box x={384} y={150} w={142} h={32} label="Gemini compose" subLabel="reply drafts" partner />
        <Box x={384} y={192} w={142} h={32} label="Aikido" subLabel="supply-chain scan" partner />

        {/* Fact store */}
        <Box x={580} y={130} w={140} h={70} label="Fact store" subLabel="bitemporal · SQLite" big />

        {/* Projection column */}
        <Box x={760} y={92} w={130} h={32} label="Renderer" />
        <Box x={760} y={138} w={130} h={32} label="Patcher" subLabel="anchor blocks" />
        <Box x={760} y={184} w={130} h={32} label="Audit log" subLabel="append-only" />

        {/* Outputs */}
        <Box x={930} y={92} w={90} h={32} label="Context.md" subtle />
        <Box x={930} y={138} w={90} h={32} label="Dashboard" subtle />
        <Box x={930} y={184} w={90} h={32} label="Agent" subtle />

        {/* Section labels along the bottom */}
        <text x={95} y={300} textAnchor="middle" fontSize="9" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.08em">SOURCES</text>
        <text x={275} y={300} textAnchor="middle" fontSize="9" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.08em">PIPELINE</text>
        <text x={455} y={300} textAnchor="middle" fontSize="9" fill="var(--brand)" fontFamily="var(--font-mono)" letterSpacing="0.08em">PARTNERS</text>
        <text x={650} y={300} textAnchor="middle" fontSize="9" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.08em">STORE</text>
        <text x={825} y={300} textAnchor="middle" fontSize="9" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.08em">PROJECTION</text>
        <text x={975} y={300} textAnchor="middle" fontSize="9" fill="var(--fg-dim)" fontFamily="var(--font-mono)" letterSpacing="0.08em">UI</text>

        {/* Sources → ingest */}
        <Arrow x1={170} y1={64} x2={210} y2={52} />
        <Arrow x1={170} y1={102} x2={210} y2={96} />
        <Arrow x1={170} y1={140} x2={210} y2={140} />

        {/* Pipeline chain */}
        <Arrow x1={275} y1={68} x2={275} y2={80} />
        <Arrow x1={275} y1={112} x2={275} y2={124} />
        <Arrow x1={275} y1={160} x2={275} y2={172} />

        {/* Reconciler → Fact store (primary path) */}
        <Arrow x1={340} y1={210} x2={580} y2={172} brand />

        {/* Reconciler fans out to ALL enrichments in parallel
            (each enrichment writes back its own facts independently). */}
        <Arrow x1={340} y1={188} x2={384} y2={82} />
        <Arrow x1={340} y1={188} x2={384} y2={124} />
        <Arrow x1={340} y1={188} x2={384} y2={166} />
        <Arrow x1={340} y1={196} x2={384} y2={208} />

        {/* Each enrichment writes back to Fact store */}
        <Arrow x1={526} y1={82} x2={580} y2={150} brand />
        <Arrow x1={526} y1={124} x2={580} y2={158} brand />
        <Arrow x1={526} y1={166} x2={580} y2={170} brand />
        <Arrow x1={526} y1={208} x2={580} y2={185} brand />

        {/* Fact store → projection column */}
        <Arrow x1={720} y1={150} x2={760} y2={108} />
        <Arrow x1={720} y1={165} x2={760} y2={154} />
        <Arrow x1={720} y1={180} x2={760} y2={200} />

        {/* Projection → outputs */}
        <Arrow x1={890} y1={108} x2={930} y2={108} />
        <Arrow x1={890} y1={154} x2={930} y2={154} brand />
        <Arrow x1={890} y1={200} x2={930} y2={200} />

        {/* Manager correction loop */}
        <path
          d="M970,124 Q840,30 720,140"
          stroke="var(--brand)"
          strokeWidth="1.4"
          strokeDasharray="3 3"
          fill="none"
          markerEnd="url(#arrBrand)"
        />
        <text x={840} y={26} textAnchor="middle" fontSize="10" fill="var(--brand)" fontFamily="var(--font-mono)" letterSpacing="0.04em">
          manager correction
        </text>
      </svg>
    </div>
  );
}

function Box({
  x,
  y,
  w,
  h,
  label,
  subLabel,
  subtle,
  partner,
  big,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  subLabel?: string;
  subtle?: boolean;
  partner?: boolean;
  big?: boolean;
}) {
  const fill = partner
    ? "var(--brand-wash)"
    : subtle
      ? "transparent"
      : "var(--bg)";
  const stroke = partner
    ? "var(--brand-line)"
    : subtle
      ? "var(--border-muted)"
      : "var(--border)";
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={6}
        ry={6}
        fill={fill}
        stroke={stroke}
        strokeWidth={partner || big ? 1.5 : 1}
      />
      <text
        x={x + w / 2}
        y={y + (subLabel ? h / 2 - 2 : h / 2 + 4)}
        textAnchor="middle"
        fontSize={big ? 13 : 12}
        fill={partner ? "var(--brand)" : "var(--fg)"}
        fontWeight={500}
      >
        {label}
      </text>
      {subLabel && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 12}
          textAnchor="middle"
          fontSize={10}
          fill="var(--fg-dim)"
          fontFamily="var(--font-mono)"
        >
          {subLabel}
        </text>
      )}
    </g>
  );
}

function Arrow({
  x1,
  y1,
  x2,
  y2,
  brand,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  brand?: boolean;
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={brand ? "var(--brand)" : "var(--fg-dim)"}
      strokeWidth={brand ? 1.5 : 1}
      markerEnd={brand ? "url(#arrBrand)" : "url(#arr)"}
    />
  );
}

// ── Data shape grid: live counts of what's seeded ─────────────────────────

function DataShapeGrid() {
  const items: Array<{ count: string; label: string; sublabel?: string }> = [
    { count: "133", label: "entities", sublabel: "1 WEG · 3 buildings · 52 units · 35 owners · 26 tenants · 16 contractors" },
    { count: "16,874", label: "facts", sublabel: "bitemporal · append-only · cited" },
    { count: "8,677", label: "sources", sublabel: "6,546 emails + 339 PDFs + 1,619 bank txns + stammdaten" },
    { count: "224", label: "live recommendations", sublabel: "across incidents, legal, financial — generated, not curated" },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 12,
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            padding: "18px 20px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 10,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--fg-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
            }}
          >
            {item.label}
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              fontFeatureSettings: '"tnum"',
              lineHeight: 1.05,
            }}
          >
            {item.count}
          </div>
          {item.sublabel && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--fg-muted)", lineHeight: 1.5 }}>
              {item.sublabel}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DiagramHeader({
  title,
  subtitle,
  extraTop,
}: {
  title: string;
  subtitle: string;
  extraTop?: number;
}) {
  return (
    <div style={{ marginTop: extraTop ?? 8, marginBottom: 12 }}>
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </div>
      <div
        className="mono"
        style={{
          marginTop: 4,
          fontSize: 11,
          color: "var(--fg-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}

// ── Email trigger workflow (mirrors docs/diagrams/02-email-trigger.drawio) ─

function EmailTriggerDiagram() {
  // Wider canvas (1140 x 320) so each step has room for two-line labels.
  // Coloring follows the same convention as the architecture SVG above.
  return (
    <div
      style={{
        padding: 20,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "auto",
      }}
    >
      <svg viewBox="0 0 1140 360" width="100%" style={{ display: "block", maxWidth: 1140 }}>
        <defs>
          <marker id="arr2" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10" fill="var(--fg-dim)" />
          </marker>
          <marker id="arr2Brand" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10" fill="var(--brand)" />
          </marker>
        </defs>

        <FlowStep x={20} y={28} w={210} h={84} num="1" title="Tenant email arrives" body="Wasser tropft aus der Decke — from edeltraud.renner@web.de" />
        <FlowStep x={250} y={28} w={170} h={84} num="2" title="Header parse" body="from / to · subject · UTF-8 decode" />
        <FlowStep x={440} y={28} w={170} h={84} num="3" title="Entity routing" body="incoming → sender · stammdaten lookup" />
        <FlowStep x={630} y={28} w={170} h={84} num="4" title="Incident classify" body="regex multi-match scorer · subject wins" />
        <FlowStep x={820} y={28} w={170} h={84} num="4a" title="LLM fallback" body="Gemini classifier when keywords miss" dashed />

        <FlowStep x={820} y={146} w={170} h={84} num="5" title="Fact write" body="incident.type + status · append-only · cited" />
        <FlowStep x={630} y={146} w={170} h={84} num="6" title="Reconciliation" body="Dawid–Skene · prior × recency" />
        <FlowStep x={440} y={146} w={170} h={84} num="7" title="Awaiting-reply detect" body="outbound after sinceIso → collapse to follow-up" />
        <FlowStep x={20} y={146} w={400} h={84} num="8" title="Recommendation build" body="severity · root-cause scan · email_chain · pre-composed reply draft" />

        <FlowStep x={20} y={264} w={520} h={70} num="9" title="UI surface" body="dashboard rec row · severity tick · step indicator · prefetch on hover" tone="user" />
        <FlowStep x={560} y={264} w={430} h={70} num="10" title="Manager actions" body="Send draft → outbound source · Dispatch → contractor email · Resolve → fact append" tone="user" />

        {/* Top row arrows */}
        <Arrow2 x1={230} y1={70} x2={250} y2={70} />
        <Arrow2 x1={420} y1={70} x2={440} y2={70} />
        <Arrow2 x1={610} y1={70} x2={630} y2={70} />
        <Arrow2 x1={800} y1={70} x2={820} y2={70} />

        {/* 4 → 4a (dashed bridge) and 4 → 5 main */}
        <Arrow2 x1={905} y1={112} x2={905} y2={146} />

        {/* Middle row arrows (right to left) */}
        <Arrow2 x1={820} y1={188} x2={800} y2={188} />
        <Arrow2 x1={630} y1={188} x2={610} y2={188} />
        <Arrow2 x1={440} y1={188} x2={420} y2={188} />

        {/* Middle → bottom row */}
        <Arrow2 x1={220} y1={230} x2={220} y2={264} brand />

        {/* UI → actions */}
        <Arrow2 x1={540} y1={299} x2={560} y2={299} />

      </svg>
    </div>
  );
}

// ── UI workflow swimlanes (mirrors docs/diagrams/03-ui-workflow.drawio) ────

function UiWorkflowDiagram() {
  const lanes: Array<{ heading: string; items: string[] }> = [
    {
      heading: "A · Triage  /dashboard",
      items: [
        "Live stat strip · 8s poll",
        "Recs sorted by severity",
        "Awaiting-reply rows muted",
        "Click row → expand",
        "Resolve → fact append",
      ],
    },
    {
      heading: "B · Act  draft · dispatch · escalate",
      items: [
        "Pre-composed reply (sessionStorage cache)",
        "Edit before send · pinned to tenant Sprache",
        "Dispatch contractor → branche-routed",
        "Escalate (legal) → suspend auto-actions",
        "Every action lands in /audit",
      ],
    },
    {
      heading: "C · Investigate  ⌘K · Context.md · sandbox",
      items: [
        "⌘K palette · 3-deep history",
        "Agent loads ≤ 24KB Context per entity",
        "Cited answer · ^[source title]",
        "/context/[entity] anchored Markdown",
        "Drop a doc → /sandbox · facts land live",
      ],
    },
    {
      heading: "D · Audit  verify · replay",
      items: [
        "/audit append-only ledger",
        "/research deep-tech foundations",
        "/technical (this page) — engineering map",
        "Replay a date · valid / known time travel",
        "Voice mode · Gradium ASR",
      ],
    },
  ];
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 12,
      }}
    >
      {lanes.map((lane) => (
        <div
          key={lane.heading}
          style={{
            padding: "16px 18px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 10,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--brand)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 10,
            }}
          >
            {lane.heading}
          </div>
          <ol
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {lane.items.map((item, i) => (
              <li
                key={item}
                style={{
                  display: "grid",
                  gridTemplateColumns: "20px 1fr",
                  gap: 8,
                  alignItems: "baseline",
                  fontSize: 12.5,
                  color: "var(--fg-muted)",
                  lineHeight: 1.5,
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: "var(--fg-dim)",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function FlowStep({
  x,
  y,
  w,
  h,
  num,
  title,
  body,
  dashed,
  tone,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  num: string;
  title: string;
  body: string;
  dashed?: boolean;
  tone?: "user";
}) {
  const fill = tone === "user" ? "var(--bg)" : "var(--bg-elevated)";
  const stroke = tone === "user" ? "var(--brand)" : "var(--border)";
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        ry={8}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      <text
        x={x + 12}
        y={y + 18}
        fontSize="10"
        fill="var(--brand)"
        fontFamily="var(--font-mono)"
        letterSpacing="0.04em"
      >
        {num}
      </text>
      <text
        x={x + 12}
        y={y + 38}
        fontSize="13"
        fill="var(--fg)"
        fontWeight={500}
      >
        {title}
      </text>
      <foreignObject x={x + 12} y={y + 46} width={w - 24} height={h - 50}>
        <div
          style={{
            fontSize: 11,
            color: "var(--fg-muted)",
            lineHeight: 1.4,
            fontFamily: "var(--font-sans)",
          }}
        >
          {body}
        </div>
      </foreignObject>
    </g>
  );
}

function Arrow2({
  x1,
  y1,
  x2,
  y2,
  brand,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  brand?: boolean;
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={brand ? "var(--brand)" : "var(--fg-dim)"}
      strokeWidth={brand ? 1.5 : 1}
      markerEnd={brand ? "url(#arr2Brand)" : "url(#arr2)"}
    />
  );
}
