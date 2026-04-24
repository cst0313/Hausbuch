# Hausbuch — Product Requirements Document

| | |
|---|---|
| **Document version** | 0.1 |
| **Status** | Active · Phase 0 |
| **Last updated** | 2026-04-24 |
| **Owner** | Jeffrey Chang |
| **Event** | Big Berlin Hack 2026 |
| **Primary track** | Buena (€2500) |
| **Secondary track** | Qontext (phase 2, fork from stable Buena commit) |
| **Source of truth** | This document. Update status inline as work lands. |

---

## 0. How to read this doc

This is a PRD, not a style guide. Every requirement is **numbered** (FR-1, DS-4, etc.) and has a **Status** field. Future runs must:

1. Read this doc top-to-bottom before touching code.
2. Update the Status column the moment a requirement changes state.
3. Append to §13 (Progress log) with a one-line entry per working session.
4. Never delete a requirement — if scope changes, mark it `Cancelled` and say why.

Status vocabulary: `Done` · `In progress` · `Pending` · `Blocked` · `Cancelled`

---

## 1. Product overview

### 1.1 One-sentence pitch

Hausbuch turns every scattered email, PDF, ERP row, and Slack message about a building into **one living, self-updating `Context.md`** per property — every fact cited, every update surgical, every action replayable.

### 1.2 The problem

Property managers live between twelve inboxes. An AI agent (or a junior PM) that needs to act on a building has to re-crawl the whole mess every time. When a new source arrives (email, memo, invoice), naïve systems **either regenerate the file from scratch** (destroying human edits and burning tokens) **or let conflicts silently resolve by "last write wins"** (losing truth).

### 1.3 The wedge

- **Facts, not chunks.** One row per claim, with a verbatim span, a source, and two time axes (valid-time, known-time).
- **Surgical patches.** Anchored `<!-- fact:X -->` blocks in the rendered Markdown. Edits between anchors survive.
- **Dawid-Skene conflict resolution.** Sources have reliabilities; posteriors over candidate values; uncertainty shows in the UI.
- **Replay.** Any moment in the past — "what did we know on 2026-04-15?" — is a first-class query.

### 1.4 What this is not

- Not RAG (no chunk retrieval at query time)
- Not a documentation chatbot
- Not a vector store + prompt glue
- Not a CRM

---

## 2. Users

| Persona | Primary need | How Hausbuch shows up |
|---|---|---|
| **Property manager** (primary) | "What happened this weekend across my 12 buildings? What needs a decision?" | `/inbox` Monday digest, `/queue` approval surface |
| **Owner / Eigentümer** (secondary) | "What's the status of my building? Are my rents being collected?" | `/context/:id` read-only summary, voice line |
| **AI agent** (tertiary) | "Give me every fact relevant to this task, with sources, now." | `/api/context/:entity` → `Context.md` string |
| **Hackathon judge** (critical) | "Is this real, and does it actually work?" | `/` landing, live demo button, `/research` paper, `/audit` activity log |

---

## 3. Functional requirements

### 3.1 Context engine (mostly inherited; do not break)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| **FR-1** | Render a `Context.md` per entity from the fact store, in a byte-stable section order (Identity → Tenancy → Condition → Contacts → History). | P0 | Done |
| **FR-2** | Every rendered fact carries an HTML-comment anchor `<!-- fact:HASH -->` so surgical patching is byte-aligned. | P0 | Done |
| **FR-3** | Schema aligner: map 91+ source-specific keys (Eigentümer, MietEig, Kontakt, owner, …) to 15 canonical predicates. | P0 | Done |
| **FR-4** | Relevance gate: reject sources below threshold 0.30; accept with anchor-token + noise-pattern scoring. | P0 | Done |
| **FR-5** | Bitemporal query: support `at_valid` and `at_known` parameters on every read endpoint. | P0 | Done |
| **FR-6** | Dawid-Skene reconciler: compute posteriors over candidate values when sources disagree. | P0 | Done |

### 3.2 Control, traceability, transparency *(new, hackathon-differentiating)*

Judges and users must be able to see **what the system did, when, and why** — every ingest, every API call, every LLM action, every enrichment. No silent work.

| ID | Requirement | Priority | Status |
|---|---|---|---|
| **FR-7** | **Action log**: a single append-only stream of every significant action. Schema: `{id, ts, actor, action, entity, target, inputs_hash, outputs_hash, latency_ms, cost_tokens?, cost_usd?, partner?}`. Actors: `user`, `ingest`, `reconciler`, `gemini`, `tavily`, `gradium`, `aikido`. | P0 | Pending |
| **FR-8** | `/audit` page that streams FR-7 events in real time (SSE), filterable by entity, actor, time range. Judge-visible proof that nothing happens silently. | P0 | Pending |
| **FR-9** | **Per-fact provenance drawer**: click any fact in the rendered `Context.md` and see the full chain — source document, extracted span, relevance score, schema-alignment path, reconciler decision, enrichment calls. | P0 | Pending |
| **FR-10** | **Tool-call transparency**: every external LLM / partner API call logs the full request (with secrets redacted), response, latency, and cost. Available via `/audit/call/:id`. | P0 | Pending |
| **FR-11** | **Honest labels** (already a convention; now a hard requirement): any heuristic output is tagged `compose-fallback`; any simulated benchmark is tagged `-simulated`; any projected number is tagged `(projected)`. | P0 | Done |

### 3.3 Context-history replay *(flagship demo feature)*

| ID | Requirement | Priority | Status |
|---|---|---|---|
| **FR-12** | **Time scrubber**: a draggable timeline on `/context/:id` that re-renders the `Context.md` as of any past `known_at` timestamp. Uses existing bitemporal query (FR-5), no new storage. | P0 | Pending |
| **FR-13** | **Diff overlay**: when scrubbing, show added facts in green, removed/superseded in strikethrough red, conflicts as amber highlights. | P0 | Pending |
| **FR-14** | **Playback mode**: press ▶ to auto-advance through the last 24h / 7d / 30d of changes at 1x / 4x / 16x speeds. The `Context.md` animates, the action log scrolls in sync. | P1 | Pending |
| **FR-15** | **Shareable replay link**: `/context/:id/replay?from=...&to=...` is a deep link that loads the scrubber to a specific time range. For the 2-min demo video, we'll link directly to the "conflict week." | P1 | Pending |

### 3.4 Platform demo *(the judge-facing surface)*

Must feel like a real product, not a research demo. Apple / NVIDIA minimalism, one primary action per view, generous whitespace, restrained motion.

| ID | Requirement | Priority | Status |
|---|---|---|---|
| **FR-16** | `/` landing: hero + 3 workflows (Inbox, Queue, Replay) + proof strip + single CTA. No "powered by" logo wall. | P0 | Pending |
| **FR-17** | `/inbox`: Monday digest per property. Sections: "What's new" (new facts), "What needs a decision" (conflicts, pending ingests), "What changed" (superseded facts). | P0 | Pending |
| **FR-18** | `/queue`: incoming-source approval. Each card: original text, proposed fact patches (add/supersede/reject), one-click approve / edit / reject. | P0 | Pending |
| **FR-19** | `/context/:id`: the living `Context.md` view with FR-9 drawers and FR-12 scrubber. | P0 | Pending |
| **FR-20** | `/research`: the existing paper + benchmark page. Reframe as a footer link from landing, not a primary nav item. | P1 | Partial (exists, needs reframe) |
| **FR-21** | `/audit`: the action log stream (FR-8). Styled like a professional observability tool (Datadog, Grafana), not a debug dump. | P0 | Pending |
| **FR-22** | German/English toggle in the nav. Default English. One-click to German for Buena-facing demo. | P1 | Pending |

### 3.5 Ingest & enrichment

| ID | Requirement | Priority | Status |
|---|---|---|---|
| **FR-23** | Drag-drop any file (PDF, JPG, PNG, EML, TXT, MD). Backend routes to the right extractor. | P0 | Partial (PDF works; needs image/email) |
| **FR-24** | **Gemini 2.5 Pro multimodal ingest** for scanned PDFs and images. Replaces `pdf-parse` for scans; adds support for meter photos and handwritten minutes. | P0 | Pending |
| **FR-25** | **Tavily live enrichment**: on rent facts, look up current Mietpreisbremse cap for the ZIP; on `identity.owner`, verify against Handelsregister; on contractors, check active registration. Enrichments cache for 24h and are themselves facts (with Tavily as source). | P0 | Pending |
| **FR-26** | **Gradium voice**: a "Call your building" widget on landing. Browser WebRTC → Gradium ASR → Gemini-grounded answer on current `Context.md` → Gradium TTS. Transcript saved to action log (FR-7). | P1 | Pending |
| **FR-27** | Email ingest accepts raw `.eml` or pasted text. Normalizes headers (From/Date/Subject) into source metadata. | P0 | Partial |

### 3.6 Security & supply-chain

| ID | Requirement | Priority | Status |
|---|---|---|---|
| **FR-28** | **Aikido** scan on the public repo. Resolve all High/Critical findings. Include scan screenshot in submission. | P1 (€1000 side prize) | Pending |
| **FR-29** | No secrets in `.env.example` or committed files. `.env.local` gitignored. | P0 | Done |
| **FR-30** | Tool-call transparency (FR-10) redacts API keys, OAuth tokens, and PII from logged payloads before persistence. | P0 | Pending |

---

## 4. Non-functional requirements

| ID | Requirement | Target | Status |
|---|---|---|---|
| **NFR-1** | Context.md render latency (cached) | <50ms p95 | Done |
| **NFR-2** | Ingest latency (text source) | <500ms p95 | Done |
| **NFR-3** | Ingest latency (Gemini multimodal) | <8s p95 | Pending |
| **NFR-4** | Agent query latency (cache-warm) | <1.2s p95 | Done (with Anthropic) |
| **NFR-5** | Byte-stable section order for prompt-cache | No reorder across renders | Done |
| **NFR-6** | Honest benchmarks | No hardcoded numbers; all cells are live API calls | Done |
| **NFR-7** | Action log retention | 30 days in demo; unbounded in schema | Pending |
| **NFR-8** | Repo cleanliness for judges | No rebuild artifacts, no `node_modules` bloat in zips | Done |

---

## 5. Partner technology integration

Hackathon requires **≥3 of 7**: Google DeepMind, Lovable, Gradium, Entire, Tavily, Aikido, Pioneer (Fastino). Anthropic is **not** on the list. Gemini is our primary LLM.

| Partner | Role | Where | Status |
|---|---|---|---|
| **Google DeepMind (Gemini 2.5 Pro)** | Composer for agent queries; multimodal ingest (FR-24); research baseline comparison | `src/lib/llm/gemini.ts` (new), `src/app/api/upload/route.ts` | Pending |
| **Tavily** | Live fact enrichment (FR-25); "verified X min ago" badges | `src/lib/enrich.ts` (new), hooks into `src/lib/ingest.ts` after reconcile | Pending |
| **Gradium** | Voice layer (FR-26) | `src/app/api/voice/route.ts` (new), landing widget | Pending (risk: fallback to Entire if blocked) |
| **Aikido** | Security scan (FR-28), side prize | Out-of-repo (SaaS) + screenshot in `docs/security.md` | Pending |
| Anthropic Claude | Optional provider adapter; demo path does not depend on it | `src/lib/llm/anthropic.ts` (existing) | Done, non-counting |

**Fallback plan**: If Gradium integration blocks past 3 hours, swap in **Entire** (human-in-the-loop approval queue, already a natural fit for FR-18). We stay at 3 partner techs.

---

## 6. Design tooling stack

This section tells future sessions **which tool to reach for when** in the design workflow. All of these are opt-in helpers; the hand-coded Tailwind baseline from §7–§10 is always canonical.

| Tool | Strength | Use for | Status / notes |
|---|---|---|---|
| **Stitch (stitch.withgoogle.com)** | Fast AI-generated UI mockups from a text brief | **Initial page-level exploration** — throwaway sketches to decide layout direction for `/inbox`, `/queue`, `/audit` before committing to code | Pending |
| **21st.dev (Magic MCP)** | AI-generated React + Tailwind components that match a brief | **Component scaffolding** — generate the first draft of `TimelineScrubber`, `FactProvenanceDrawer`, `ActionLogStream`. Hand-tune to match §7 tokens after. | Pending |
| **UI UX Pro Max** | Interaction / usability review | **Design QA pass** before Phase 4 submission. Run on `/inbox` and `/queue` to catch flow problems judges would notice. | Pending |
| **Google MCP (Gemini + Imagen)** | Grounded multimodal reasoning, including image gen | **Live product narration** in the demo video (optional); asset generation where photography isn't feasible | Pending |
| **Nano Banana 2 (Gemini 3 Pro Image)** | Best-in-class image generation + edit | **Hero imagery, OG images, brand illustrations** — the single marketing asset on the landing page. NO stock 3D isometric junk. | Pending |

**Rule of thumb**: every AI-design tool is a drafting aid. Nothing ships without a human refinement pass against the tokens in §7. All generated assets go in `public/generated/` with a sidecar `.txt` listing the prompt, tool, and date — traceability applies to design too (FR-7 spirit).

---

## 7. Design system — tokens

Distilled from buena.com's production CSS (retrieved 2026-04-24 from `/_next/static/css/0f08b18873089489.css` and `f9f6c5fe7f84540f.css`).

### 7.1 Color — dark theme (default product surface)

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#010105` | Page background (near-black, cool tint) |
| `--bg-elevated` | `#171717` | Cards, modals |
| `--bg-hover` | `#292524` | Hover on dark |
| `--border` | `#292524` (stone-800) | Hairline |
| `--border-muted` | `#44403c` | Button outline, secondary hairline |
| `--fg` | `#fafaf9` (stone-50) | Primary text |
| `--fg-muted` | `#a8a29e` (stone-400) | Secondary text |
| `--fg-dim` | `#78716c` (stone-500) | Tertiary |

### 7.2 Color — light theme (marketing / Buena-facing)

| Token | Hex | Usage |
|---|---|---|
| `--bg` | `#ffffff` | Page |
| `--bg-elevated` | `#fafaf9` | Cards |
| `--bg-hover` | `#e7e5e4` | |
| `--border` | `#f5f5f4` (stone-100) | Hairline |
| `--border-muted` | `#e7e5e4` (stone-200) | |
| `--fg` | `#1c1917` (stone-900) | Primary text |
| `--fg-muted` | `#57534e` (stone-600) | Body |

### 7.3 Brand accents (cross-theme)

| Token | Hex | Usage |
|---|---|---|
| `--brand` | `#0d7835` | Primary CTA, focus rings |
| `--brand-hover` | `#0d7835e5` | CTA hover (90%) |
| `--brand-tint` | `#398957` | Inline highlights, success |
| `--brand-wash` | `#0d542b33` | Low-alpha green panels |
| `--accent-sand` | `#cdbda3` | Warm beige — sparingly |
| `--accent-sage` | `#d6dbd5` | `--weg-color` in Buena's source — reserved for WEG / co-owner contexts |

### 7.4 Neutral ramp (Tailwind Stone)

`#fafaf9 → #f5f5f4 → #e7e5e4 → #d6d3d1 → #a8a29e → #78716c → #57534e → #44403c → #292524 → #1c1917 → #0c0a09`

Only Stone. No gray, no zinc, no slate.

### 7.5 Semantic

| Token | Hex | Usage |
|---|---|---|
| `--success` | `#0d7835` | Verified by Tavily, ingested cleanly |
| `--warning` | `#b45309` | Conflict detected |
| `--danger` | `#991b1b` | Ingest failed |
| `--info` | `#0c4a6e` | Hints |

---

## 8. Typography

| Role | Font | Weights | Where |
|---|---|---|---|
| UI / body | **Inter Tight** | 400, 500, 600 | Default everything |
| Display | **Inter Display (Medium)** | 500 | Hero numerals, marketing stats |
| Serif accent | **Signifier** | 400, 400 italic | Pull quotes, callouts |
| Mono | System mono | 400 | Code, `Context.md` preview, fact IDs |

### 8.1 Scale (rem / line-height)

| Step | Size | LH | Use |
|---|---|---|---|
| xs | 0.75 | 1.333 | Captions, fact-ID labels |
| sm | 0.875 | 1.428 | Secondary body |
| base | 1 | 1.5 | Body default |
| lg | 1.125 | 1.555 | Lead paragraphs |
| xl | 1.25 | 1.4 | Subheadings |
| 2xl | 1.5 | 1.333 | Section headings |
| 3xl | 1.875 | 1.2 | Page titles |
| 4xl | 2.25 | 1.111 | Feature h1 |
| 6xl | 3.75 | 1.0 | Landing hero |
| 8xl | 6 | 0.9 | Monster numerals |

Letter-spacing: `-0.04em` at 4xl+, `-0.02em` at 2xl–3xl, default (0) for body.

---

## 9. Spacing, elevation, motion

### 9.1 Spacing

4px base. Container max-widths: 640 / 768 / 1024 / 1280 / 1536. Hero caps at 768px. Section rhythm: `py-16 / py-24 / py-32` (mobile/tablet/desktop). Radius: `lg` (8px) cards, `md` (6px) inputs/buttons, `full` chips. Borders always 1px.

### 9.2 Elevation

| Token | Value |
|---|---|
| sm | `0 1px 2px rgba(0,0,0,0.1)` |
| md | `0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)` |
| lg | `0 16px 32px rgba(0,0,0,0.1)` |

No colored shadows. No glow.

### 9.3 Motion

Apple / NVIDIA restraint. Durations 150 / 250 / 400 ms. Easing `cubic-bezier(0.4, 0, 0.2, 1)`. Animate only opacity and transform. No parallax, no auto-play, no confetti, no spring physics on marketing pages.

---

## 10. Component primitives

### 10.1 Button

```
Primary:  bg-white text-stone-950               hover: bg-stone-200
Brand:    bg-[#0d7835cc] text-white             hover: bg-[#0d7835e5]
Outline:  border border-stone-800 text-stone-50 hover: bg-stone-900 (dark)
          border border-stone-300 text-stone-900 hover: bg-stone-50 (light)
Ghost:    text-stone-400 hover: bg-stone-900 (dark) / text-stone-600 hover: bg-stone-100 (light)
```

Heights: `h-9` default, `h-10` CTAs, `h-8` dense. Padding: `px-4` default, `px-6` CTAs.

### 10.2 Hausbuch-specific primitives

| Component | Purpose | Status |
|---|---|---|
| `FactAnchor` | Inline citation chip after any fact: `^mono-small-text`, hover → provenance drawer | Pending |
| `FactProvenanceDrawer` | FR-9: full provenance chain for a fact | Pending |
| `TimelineScrubber` | FR-12/13: draggable time control with diff overlay | Pending |
| `ActionLogStream` | FR-8: SSE-fed event stream, filterable | Pending |
| `ToolCallCard` | FR-10: one expanded external API call | Pending |
| `ReplayControls` | FR-14/15: play/pause, speed, range, shareable link | Pending |

---

## 11. Anti-patterns (hard no)

- Stock 3D isometric illustrations, AI hero art with smooth-gradient glass buildings
- Gradient text
- Glassmorphism / backdrop-blur > 8px
- Shimmer skeletons
- Emoji in UI labels
- Full-width video hero
- "Trusted by" logo walls with >6 logos
- Purple anywhere

---

## 12. Copy — voice samples

Buena's anchors (retained verbatim for German-mode):

> "Für Eigentümer, die von Mittelmaß genug haben."
> "Weil 90 % der Hausverwaltungen nicht verwalten. Sie reagieren nur."
> "Klartext spricht – ohne Juristendeutsch."

English adaptations for the demo:

> **Hero**: "One document per building. Updates itself. Cites every source."
> **Subhead**: "90% of property managers react. Hausbuch remembers."
> **CTA**: "Open your first building"
> **Footer anchor**: "Plain English. No legalese. The document every building should already have."

---

## 13. Progress log

Append one line per working session. Newest at top.

| Date | Phase | Session summary |
|---|---|---|
| 2026-04-24 | Phase 0 | Renamed project to hausbuch; fresh LICENSE (BSL-1.1, no carve-out), .gitignore, CONTRIBUTING.md, README skeleton; extracted Buena brand from production CSS; drafted this PRD with tokens, FRs, NFRs, partner-tech allocation, design-tool stack. No code changes to `src/` yet. |

---

## 14. Milestones

| Phase | Scope | Gate criteria | Status |
|---|---|---|---|
| **0 — Foundation** | Repo hygiene, LICENSE, this PRD | PRD reviewed by owner; Git repo initialized | In progress |
| **1 — Product repositioning** | Landing + /inbox + /queue skins, German toggle, Buena palette applied | FR-16, FR-17, FR-18, FR-22 Done | Pending |
| **2 — Partner integrations** (parallel) | FR-24, FR-25, FR-26 (or Entire fallback), FR-28 | All four agents merged; tests pass; no regressions | Pending |
| **3 — Transparency & replay** | FR-7 through FR-15 (action log, audit page, time scrubber, replay) | Judge can open /audit and see every action; can scrub /context/:id timeline | Pending |
| **4 — Demo polish** | Hero imagery (Nano Banana 2), 2-min Loom, final README | Video recorded; repo tagged v1.0.0; submitted | Pending |

---

## 15. Risks and open questions

| ID | Risk / question | Mitigation | Status |
|---|---|---|---|
| **R-1** | Gradium realtime voice integration blocks | 3h timebox; fallback to Entire for 3rd partner tech | Pending |
| **R-2** | Anthropic credit balance empty | Gemini is primary composer; Anthropic is optional | Accepted |
| **R-3** | Gemini 2.5 Pro multimodal latency >8s | Async ingest with WebSocket progress; SSE in action log | Pending |
| **R-4** | Aikido scan surfaces Critical findings in inherited code | Triage during Phase 4; if unfixable in scope, document in `docs/security.md` | Pending |
| **R-5** | BSL-1.1 unusual for hackathon — judges may prefer permissive | Explain in README; BSL converts to Apache 2.0 on 2028-04-24 | Accepted |
| **Q-1** | Do we need per-tenant / multi-property view, or is single-property enough for demo? | Single-property for demo; multi-property scaffold in schema only | Pending owner decision |
| **Q-2** | Should `/audit` be public in the hosted demo, or auth-gated? | Public for demo (everything is dummy data) | Pending owner decision |

---

_End of PRD. Future runs: if you add a requirement, give it an ID, put it in the right §, update §13, and check §14 for gate impact._
