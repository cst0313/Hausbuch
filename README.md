# Hausbuch

<!-- Update <ORG>/<REPO> below to the actual Aikido org/repo path after the first scan completes. -->
[![Aikido Security](https://app.aikido.dev/badges/<ORG>/<REPO>/main.svg)](https://app.aikido.dev)

> A context engine for property management. One living, self-updating, citation-backed `Context.md` per building.

**Status**: hackathon preview · Big Berlin Hack · Buena track

---

## What it does

Every property manager lives between twelve inboxes — emails, ERPs, shared drives, scanned PDFs, Slack, and the head of the person who's been there twelve years. Hausbuch turns that into one document per building that:

- writes itself as new sources arrive
- never destroys your edits (surgical updates, not regeneration)
- cites the exact line in the exact source for every claim
- survives schema drift (Eigentümer / MietEig / Kontakt / Owner all land in the same predicate)
- judges signal from noise before anything reaches the document

## Why it is not RAG

A RAG pipeline returns chunks. Hausbuch returns **facts** — one row per claim, with two time axes (valid time, known time), a verbatim span, a confidence, and a source. Conflicts are resolved by a 15-line Dawid–Skene reconciler, not by "most recent wins". The `Context.md` is rendered from those facts on demand, in a byte-stable order, so the Anthropic prompt cache actually hits.

See [`PAPER.md`](PAPER.md) for the long-form argument.

## Quick start

```bash
npm install
cp .env.example .env.local                      # then fill in GEMINI_API_KEY
unzip hackathon-*.zip -d tmp/                   # produces tmp/hackathon/{stammdaten,emails,briefe,rechnungen,bank,incremental}
node scripts/extract-pdf-texts.mjs              # one-time: pre-extracts text from 339 PDFs
npm run dev                                     # http://localhost:3000
```

The fact store seeds automatically on first request from `tmp/hackathon/`. Resetting:

```bash
curl -X POST http://localhost:3000/api/reset    # truncates tables and re-seeds in place
```

## Architecture diagrams

Three drawio files in `docs/diagrams/` cover the system at a glance — open them at
[app.diagrams.net](https://app.diagrams.net) or with the VS Code Drawio Integration extension:

- `01-architecture.drawio` — data sources → ingestion → bitemporal store → reconciliation → UI
- `02-email-trigger.drawio` — what happens when a tenant email arrives, end-to-end
- `03-ui-workflow.drawio` — a property manager's morning, lane-by-lane (triage / act / investigate / audit)

## Partner technologies

- **Google Gemini 2.5** — multimodal ingest (scanned leases, meter photos, assembly minutes) and default composer
- **Tavily** — live enrichment (Mietpreisbremse caps by ZIP, Handelsregister, contractor registry)
- **Gradium** — voice layer: "call your building"
- **Aikido** — security scanning (see `docs/security.md`)

## Security

Continuously scanned by Aikido on every push to `main`. See
[`docs/security.md`](docs/security.md) for scope, disclosure policy,
threat model, and known risks in the hackathon build.

## License

[Business Source License 1.1](LICENSE). Converts to Apache 2.0 on 2028-04-24.

---

_Built in Berlin, April 2026._
