# Brief: Hausbuch — Property Manager Workspace

> **Source of style truth: [buena.com](https://buena.com).** Mirror their typography rhythm, their stone-neutral surfaces, their single-green accent (`#0d7835`), their plain-spoken copy ("Klartext spricht — ohne Juristendeutsch"). No glass, no gradients, no 3D, no purple, no amber sweeps. If a treatment wouldn't appear on buena.com, don't ship it here. Hausbuch is the Buena-internal tool that Buena property managers themselves would use.

---

## 1. Product context

Hausbuch is a context engine for property management. Every email, PDF, invoice, contract, owner letter, contractor receipt, and Slack message about a building is ingested into a single self-updating Markdown document per entity (WEG, building, unit, tenant, owner, contractor). Facts are bitemporal (valid-time + known-time), source-cited, and reconciled with Dawid-Skene posteriors when sources disagree.

A senior property manager juggling ~50 buildings, ~1,000 units, ~30 contractors gets ~50 inbound items/day. Their day is reactive: triage, draft replies, dispatch handymen, escalate. **They want to act, not search.**

**The product no longer ships a separate `/demo` page.** The new dashboard *is* the demo — it must be visually coherent and persuasive to a stranger walking up to the screen, while remaining the daily workspace for someone using it 8 hours a day.

## 2. What is already built (DO NOT redesign — extend)

These surfaces exist and work end-to-end. The new design must coexist with them and reuse their patterns.

| Surface | URL | What it does |
|---|---|---|
| Agent (PM copilot) | `/dashboard` | Text + voice (Gradium-stubbed) chat against the entire fact store. Returns reasoning steps, citations, suggested follow-ups. **This is the page being redesigned as the new home.** |
| Inbox | `/inbox` | Severity-grouped recommendation cards with reputation flags, action buttons (`Dispatch X`, `Draft reply`, `Escalate`), inline note composer for freeform input |
| Queue | `/queue` | Pending fact proposals — approve / reject / edit-first |
| Audit | `/audit` | Action log with two views: flat (every action newest first) and per-task stream (grouped by source/email, showing the chain — *"step 4 of 6"*). Free-text search across entity / target / payloads |
| Docs (technical) | `/technical` | Long-form engineering walkthrough — currently styled with the legacy amber palette and needs a visual refresh as part of this design pass. |
| Context.md | `/context/:id` | Rendered Markdown per entity with bitemporal scrubber params (`at_valid`, `at_known`) |

## 3. What you're designing

A coherent **workspace** layered over the existing surfaces, with four new artifacts and visual refresh on the rest.

### 3.1 Home dashboard (NEW — replaces `/dashboard`)
This is both the daily workspace AND the demo surface. A stranger walking past should grasp the product in 10 seconds; a manager using it daily should triage 50 items in 30 minutes.

- **Top status row** — 4–6 KPI tiles, no charts: open critical, awaiting reply, dispatched today, items resolved this week. Each is one number + one descriptor; tap-through to filtered Inbox.
- **Today** — the manager's prioritized triage column. Reuse Inbox card shape but limit to the top 6 items needing a decision today. Above the column: a **digest line** in plain English (sourced from `/api/digest/{entity}`) — *"Three new lawyer letters this morning, two contractor confirmations pending, one owner approval overdue."*
- **In flight** — a column of currently-running streams (from `/api/audit?view=stream`, filtered to `last_at` < 24h). Each row: 1-line task, current step (e.g. *"Awaiting Sanitaer Schulze ETA"*), elapsed time, jump-to-stream link.
- **Latest activity** — compressed timeline (last 10 actions across the system), reuse the audit row pattern at smaller scale.
- **Agent dock** at bottom-right (always visible across pages): a single pill that says *"Ask anything… ⌘K"*. Click or hit ⌘K → command palette opens. See §3.4.

The dashboard is **demo-grade**: clicking any card or row opens a real surface (stream panel, profile, timeline). Nothing is decorative; everything is interactive. The Buena visitor walking up to the screen should be able to click in and see real data.

### 3.2 Click-to-open surfaces from the dashboard

The dashboard's value lives in the depth behind every clickable thing. Each of these opens as a slide-in panel (right-rail, takes half the viewport, dismissable):

- **Email stream panel** (from any Today / In flight card): the full thread oldest → newest, system actions interleaved (ingest, enrichment, identity-match, draft generated). Header shows *"Step N of M — 〈current step〉"*. Right rail: prepared draft reply (from `/api/draft`) editable inline + Send / Edit / Reassign / Escalate buttons. Footer: cumulative cost (sum of partner `cost_usd`), latency, partner badges (gemini · tavily · cala). See §3.6.
- **Tenant profile panel** (from any tenant name): identity (name, email, phone), tenancy (unit, rent, dates), reputation panel (score / band / open incidents / dunning notices), **cross-unit history** (`related_units` — *"Lived at WE 04 from 2019–2022 with 3 prior incidents"*), full email history with this tenant. Single primary action: *Draft to tenant*.
- **Owner profile panel** (from any owner name): identity + properties owned + rent payment status. **Cala verification chip** if `identity.owner_cala_verified` exists — *"Verified via Cala · Kranz Vermögens GbR · Duisburg · founded 2019."* Full email history. Action: *Draft to owner*.
- **Handyman/contractor profile panel** (from any contractor name OR from the Dispatch picker): generated photo placeholder, name, trade, contact, address, **reputation badge** (band, score, open incidents, dunning notices), **recent jobs** (last 3–5 dispatches with outcome — resolved / open / disputed — and cost), **Cala verification chip** if `contractor.cala_verified` exists. Action: *Dispatch to job…* opens a draft job-order email pinned to the current open recommendation.
- **Building / unit profile panel** (from any unit number): unit details (Lage, Größe, Zimmer), current tenant, current owner, recent activity at this unit, open incidents.

All five profile panels share one component skeleton — header (name + type tag + reputation/verification chips), three to four collapsible sections, primary action at the bottom. Different content by entity type, same shape.

### 3.3 Timeline / replay surface (NEW — `/timeline` or modal from any context)
The bitemporal story made visible. We already have `at_valid` / `at_known` params on `/api/context/:id` — design needs to expose them.

- **Two horizontal scrubber tracks** spanning the entity's known timeframe:
  - **valid_time** track (above) — when facts became true in the world
  - **known_time** track (below) — when Hausbuch learned them
- Drag either thumb. The Context.md preview re-renders below with a diff overlay (added / removed / superseded since the last position).
- **Playback controls**: ⏮ ⏯ ⏭ at 1× / 4× / 16×. Auto-advances known_time forward; the document mutates in place, conflicts light up when they form, supersede when resolved.
- **Shareable link**: `?from=…&to=…&entity=…` so a manager can send a colleague *"this is what we knew on April 15."*
- Style: Final Cut, not Salesforce. Sparse, monospaced timestamps, brand-green active region.

### 3.4 ⌘K command palette (NEW — global)
Hit ⌘K (or `/`) anywhere. A centered modal opens. Single input. As the manager types, results stream in, grouped:

- **Ask the agent** (always first): *"Ask: 〈your query〉"* → submits to `/api/agent`, opens the result in an inline pane below the input. The reply renders the agent's `steps[]` (thinking · searching · analyzing · answering) progressively, then the cited answer with `suggestions[]` rendered as tappable buttons.
- **Tenants / Owners / Contractors** — fuzzy match against `/api/entities`
- **Open recommendations** — match against `/api/recommendations`
- **Past audit streams** — match against `/api/audit?q=…&view=stream`
- **Buildings / units** — match against `/api/entities?type=building|unit`

Each result line is a single row, mono-grid, with: one icon by type (◊ tenant, ▢ contractor, ◇ owner, ▦ unit, ⛶ building, ◐ recommendation, ⌗ audit), the name, a one-line context, a right-aligned tag (e.g. *3 open* / *avoid · 0.19*).

Keyboard-first: ↑↓ navigate, ↵ to select (opens the relevant profile/stream panel from §3.2), ⌘↵ to open in a new pane. Esc closes.

### 3.5 Docs / technical reference (LIGHT REFRESH — `/technical`)
The page already exists with full long-form content (storage model, bitemporality, Dawid-Skene, citations, cache-engineered rendering, RAG-vs-long-context comparison). It's currently styled with legacy amber tokens and needs visual alignment.

What it should answer for an engineering reader:
- **What primitive replaces the chunk?** Bitemporal facts: one row per claim, `(valid_from, valid_to)` × `(known_from, known_to)`, a verbatim source span, a per-source confidence, and a Dawid-Skene posterior when sources disagree.
- **How are conflicts resolved?** 15-line Dawid-Skene EM in `src/lib/reconciler.ts`. Posteriors render directly in the Markdown.
- **How is the rendered Markdown engineered?** Stable section order, padded keys, anchor blocks (`<!-- fact:IDENT -->`) for surgical patching that survives human edits.
- **Why two time axes?** *"What did we know on April 15?"* needs `known_time`; *"What was the rent in June 2026?"* needs `valid_time`. Most teams collapse to a single `updated_at` and lose both.
- **How do partners plug in?** Gemini for extraction + composition; Tavily for Mietpreisbremse + Handelsregister enrichment; Cala for entity verification with reputation propagation; Aikido for supply-chain scanning. Every partner call is recorded in the audit log with redacted payloads.
- **What's the read path?** O(facts-per-entity), independent of corpus size. Each entity's Context.md stays under 30KB regardless of whether the system has 4M emails or 4K. (Scale answer: ~22h cold ingest at 50-way parallelism for 4M emails; steady-state queries cost cents/day per property.)
- **What's the action-log shape?** Append-only `actions` table; one row per significant step (ingest, llm.compose, enrich.*, user.approve, user.reject). API keys redacted before persistence (FR-30). Streamable per-target view groups steps into "tasks".

Visual refresh: same Buena palette, Inter Tight + Instrument Serif (italic for accent only) + JetBrains Mono. Replace the editorial amber with brand green for accents. Use one inline diagram per major section (boxes-and-lines, no 3D, no shadow). Code samples use the JetBrains Mono token already in the system.

### 3.6 Stream detail panel (NEW — slide-in from right, also reachable from §3.2)
Triggered from: a Today/In flight card on the dashboard, an Audit stream row, a ⌘K result, a profile panel's email-history list. **Same component everywhere.**

Anatomy:

- **Header**: entity name + type tag, severity dot, *"Step N of M — 〈current step description〉"* derived from the stream's actions.
- **Communication timeline** (left, full-height): every inbound + outbound message in chronological order; system actions interleaved (ingest, enrichment, draft generated). Each item collapsible, one-tap to expand the verbatim source (`raw_excerpt`).
- **Action panel** (right rail):
  - The **prepared draft reply** (from `/api/draft`) in an editable textarea. Send button posts to a (to-be-built) `/api/send` and appends a `user.send` action to the stream.
  - **Suggested follow-ups** from `/api/agent`'s `suggestions[]` (e.g. *Dispatch handyman*, *Escalate to legal*).
  - **Reputation summary** for the involved tenant/contractor (`/api/reputation`).
- **Footer**: cost ticker (sum of partner costs), latency (sum of `latency_ms`), partner badges (gemini · tavily · cala).

### 3.7 Contractor profile picker (NEW — overlay from "Dispatch handyman")
Filtered by trade. Each card uses the same skeleton as the contractor profile panel (§3.2) but compressed:

- Generated photo placeholder.
- Name, trade, contact.
- **Reputation badge** with band, score, open incidents, dunning notices.
- **Recent jobs** — last 3–5 with outcome.
- **Cala verification chip** if present.
- Single primary action: *Dispatch* → drafts a job-order email via `/api/draft`, appends to the stream.

Visibly favor higher-reputation contractors. When the system would route around a worse vendor, show explicit copy: *"Picked Sanitaer Schulze (0.45) over Hausmeister Mueller (0.19) — 20 open incidents, 14 dunning notices."*

### 3.8 Inbox + Audit visual refresh (LIGHT TOUCH)
Don't redesign; align. Apply the same card/row scale, the same green accent, the same monospace metadata pattern as the new home + timeline. Make sure navigating Home → Inbox → Stream Panel → Audit feels like one product.

## 4. Existing visual system — match exactly

These are already in `globals.css`. Use the variables, not raw hex.

```
--bg          stone-50    /* page background */
--bg-elevated stone-100   /* cards */
--bg-hover    stone-200   /* hover */
--fg          stone-900   /* primary text */
--fg-muted    stone-600   /* body text */
--fg-dim      stone-400   /* metadata */
--border      stone-200
--border-muted stone-300
--brand       #0d7835     /* THE green — single accent */
--brand-wash  rgba(13,120,53,0.08)  /* tint */
```

Severity (only when needed): `#991b1b` critical, `#b45309` high, `#0c4a6e` info. Use sparingly — small dots and chips, never large fills.

**Typography**:
- Sans + Display: **Inter Tight** (400, 500, 600). Letter-spacing tight at display sizes (`-0.03em` to `-0.04em`).
- Serif: **Instrument Serif** italic *only* for editorial accents (single phrase per page, e.g. *"One living document."*). Never as body copy.
- Mono: **JetBrains Mono** for timestamps, IDs, badges, source titles.

**Spacing & rhythm**:
- 14px body, 12px secondary, 10–11px monospace metadata. Generous vertical air between sections (60–80px); tight 12–16px inside cards.
- Border-radius 6–8px. No oversized rounded shapes.
- Single 1px borders, never doubled.

**Tone of voice** (enforced; copy that breaks tone gets bounced back):
- Plain English (or plain German with `LocaleToggle`). No corporate hedge.
- No exclamation points except in error toasts.
- "We" as the manager + system together, not the company.

## 5. Data shapes the design renders

Real shapes — use these in mockups for accuracy.

```ts
// GET /api/recommendations
type Recommendation = {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  entity_id: string;            // "tenant:MIE-016"
  entity_name: string;
  entity_type: "tenant" | "owner" | "contractor" | "unit" | "building" | "weg";
  category: string;             // "incident.water_damage"
  title: string; title_en: string;
  summary: string; summary_en: string;
  facts: Array<{ predicate: string; value: string; source_title: string; known_from: string }>;
  email_chain: Array<{ source_id: string; title: string; from: string; date: string; excerpt: string }>;
  actions: Array<{
    type: "dispatch_contractor" | "draft_email" | "escalate" | "follow_up";
    label: string; label_de: string;
    recipient?: { entity_id: string; name: string; email?: string; role: string };
    reputation?: {
      score: number; band: "avoid" | "neutral" | "trusted";
      incidents_open: number; mahnung_count: number;
      avoided?: { entity_id: string; name: string; score: number };
    };
  }>;
  entity_reputation?: {
    score: number; band: "avoid" | "neutral" | "trusted";
    incidents_open: number; mahnung_count: number;
    related_units?: string[];   // tenants: cross-unit history
  };
  created_at: string;
};

// POST /api/agent — the copilot
type AgentResponse = {
  answer: string;                // markdown, with citations
  citations: string[];
  steps: Array<{
    type: "thinking" | "searching" | "analyzing" | "answering" | "suggesting" | "learning";
    content: string; ts: string;
  }>;
  suggestions: Array<{
    type: "draft_email" | "dispatch" | "escalate" | "follow_up" | "investigate";
    label: string; detail?: string;
  }>;
  entities_accessed: string[];
  facts_used: number;
  model: string;                 // "gemini-2.5-flash"
  latency_ms: number;
};

// POST /api/agent/voice — multipart audio → AgentResponse + transcription metadata

// GET /api/audit?view=stream
type Stream = {
  target: string;                // typically a source_id
  entity: string | null;
  first_at: string; last_at: string;
  steps: Array<{
    id: string; ts: string;
    actor: "user" | "ingest" | "gemini" | "tavily" | "cala" | "reconciler" | "system";
    action: string;              // "source.ingest", "llm.compose", "enrich.owner_cala_verified"…
    partner: string | null;
    latency_ms: number | null;
    cost_tokens: number | null; cost_usd: number | null;
  }>;
};
// Also: ?q=…  ?actor=…  ?target=…  ?since=…

// GET /api/reputation?entity=contractor:DL-013
type Reputation = {
  entity_id: string;
  score: number;                 // 0..1
  band: "avoid" | "neutral" | "trusted";
  incidents_total: number; incidents_open: number; mahnung_count: number;
  flags: Array<{
    kind: "incident_open" | "incident_resolved" | "mahnung" | "kuendigung" | "verkaufsabsicht" | "long_tenure";
    weight: number; note?: string; at: string;
  }>;
  last_incident_at: string | null;
};
// Bulk: ?entities=a,b,c ; tenant history: ?tenant=…&history=1

// GET /api/digest/{entity}
type Digest = {
  entity_id: string;
  generated_at: string;
  whats_new: string[]; needs_decision: string[]; what_changed: string[];
};

// POST /api/draft → drafts an email body via Gemini
type DraftResult = {
  subject: string; body: string; to: string; to_email: string;
  latency_ms: number; model: string;
};

// GET /api/context/{entity}?detail=3&at_valid=…&at_known=…  →  text/markdown
//   Renders bitemporally; the timeline scrubber feeds these params

// GET /api/entities?type=tenant|owner|contractor|unit|building|weg
type Entity = { id: string; type: string; name: string; meta?: object };

// POST /api/ingest with { entity, source: { kind, title, raw_excerpt, source_prior?, from_addr? } }
//   Identity resolution fires when `from_addr` is set: matches owner/tenant/contractor by email
//   and prefetches related Context.md files. Cala + Tavily enrichments fire on owner/contractor facts.

// POST /api/queue + GET /api/queue?entity=… — fact proposal approve/reject
// POST /api/upload — multipart files (.pdf, .eml, .txt, .md, images via Gemini OCR)
```

## 6. Sample data for the mockups

Use these so the design feels like a real day:

- **Tenant**: Frau Magrit Mitschke, WE 32, Berliner WEG. Open: water damage, mold, heating failure. Just escalated via lawyer (Kanzlei Berger & Partner). Reputation 0.04 / avoid · 46 open · 12 dunning.
- **Owners**: Frau Gertraud Holsten (owns WE 47 + WE 33; emails arrive from `gertraud.holsten@gmail.com` — identity-resolves on ingest, prefetches both unit contexts); Kranz Vermögensverwaltung (Cala-verified as Kranz Vermögens GbR, Duisburg, founded 2019).
- **Contractors for water damage**: Sanitaer Schulze (0.21, 16 open, 13 dunning), Hausmeister Mueller (0.19, 20 open, 14 dunning), Heiztechnik Berlin (0.15).
- **Recent jobs for Sanitaer Schulze** (mock): WE 12 leak repair · resolved · 2026-03-14 · €280; WE 19 boiler service · open · 2026-04-02 · €450; WE 47 pipe burst · disputed · 2025-12-01 · €1,210.
- **Agent query example**: *"What's the most urgent open issue at WEG Immanuelkirchstraße 26?"* → answer mentions WE 32 lawyer letter, suggests *Dispatch Sanitaer Schulze* and *Draft response to Kanzlei Berger*.

## 7. Flows to mock

1. **Morning triage**: Home → digest line catches the eye → click critical card → stream panel slides in → reads timeline → clicks *Send reply* → toast → card moves to "resolved today" column.
2. **⌘K agent search**: from anywhere, ⌘K → type *"contractor for water damage in Haus 14"* → first row is *"Ask the agent: …"* → ↵ → answer streams in with reasoning steps, suggests Sanitaer Schulze with reputation reasoning, *Dispatch* button right there.
3. **Tenant drill-down**: from Inbox card, click tenant name → tenant profile panel slides in → reputation panel shows 46 open · 12 dunning · *"history at 0 other units"* → email history list → click an email → stream panel replaces tenant panel with full thread.
4. **Handyman dispatch with reputation**: stream panel → *Dispatch handyman* → contractor picker shows three cards in reputation order → click Sanitaer Schulze profile → see recent jobs (WE 12 resolved, WE 47 disputed) → click *Dispatch* → draft job-order email inline → send → stream gets new step *"Job order sent · 12:42 · gemini · 1,820 tokens"*.
5. **Replay**: stream panel mentions *"as of April 15"* → click date → opens timeline modal pre-positioned at that timestamp → manager scrubs forward, watches the lawyer letter arrive, the conflict form, the heating fact insert → exits back to stream.

## 8. Out of scope

- No mobile layout. Desktop-first; min width 1280px.
- No analytics charts. This is operational, not BI.
- No auth / login screens.
- No new entity types beyond what already exists.
- Don't redesign Inbox / Audit / Queue from scratch — only align them visually with the new Home + Timeline.

## 9. Deliverables

- High-fidelity mockup of the new home dashboard at `/dashboard`
- The five profile panels (tenant / owner / contractor / unit / building) — same skeleton, different content
- Stream detail panel (slide-in from right) — applied state from a critical card
- ⌘K command palette — three states: empty, mid-typing with grouped results, agent answer streaming
- Timeline / replay surface — full-screen modal showing the bitemporal scrubber + diff overlay
- Contractor profile picker — overlay with three cards
- Visual refresh of `/technical` (Docs) — same content, Buena-aligned palette and rhythm
- Light visual updates to `/inbox` and `/audit` so the system reads as one product
- Tokens / Tailwind classes that match the existing palette so the engineer can wire it up directly

## 10. Wiring notes (for the implementing engineer, not the designer)

When the design lands:
- Mount the new home as `/dashboard`. Decide whether to also redirect `/` for authed users.
- Fan in `/api/recommendations`, `/api/audit?view=stream`, `/api/digest/:entity`, `/api/agent`, `/api/reputation`, `/api/draft`, `/api/entities`.
- Reuse `NoteComposer`, `EntityReputationLine`, `LocaleProvider`, the `Nav` component.
- ⌘K palette: a global `<Cmdk />` mounted in `layout.tsx`, hooks `Mod+K` and `/`, debounces 200ms before fanning out queries.
- Profile panels: one `<EntityProfilePanel entityId="…" />` component, switches body by entity type prefix.
- Send-reply: build `/api/send` (currently stubbed); writes a `kind=letter` source with `direction=outgoing`.
- Mark-resolved: posts a `kind=note` ingest with `incident.status=resolved` predicate.
- Timeline: the renderer already accepts `at_valid` / `at_known`; new component is purely presentational. Replay link: `/context/:id?at_known=…&at_valid=…` already works; the timeline owns the URL state.
- `/technical` refresh: edit existing file, swap `var(--ink-*)` and `var(--amber-*)` tokens for the `--fg-*` / `--brand` tokens; same content stays.
- Old `/demo` page can be deleted after the new dashboard is approved (it's no longer linked from the nav or home).
