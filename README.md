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
git clone https://github.com/cst0313/Hausbuch.git
cd Hausbuch
npm install
npm run dev                                     # http://localhost:3000
```

That's it. The repo ships a pre-seeded SQLite snapshot at `data/hausbuch.db`
(135 entities, 14k facts from the public Immanuelkirchstr. 26 hackathon
corpus), so the demo runs end-to-end without any API keys, dataset
downloads, or seed scripts.

> `npm install` builds the native `better-sqlite3` binding. On most
> machines a prebuilt is downloaded automatically. If it falls back to
> source: Linux needs `build-essential` + `python3`; macOS needs Xcode CLT
> (`xcode-select --install`); Windows needs the "Desktop development with
> C++" workload from Visual Studio Build Tools.

### Optional: turn on the live LLM features

Browsing the seeded corpus needs nothing. The features below need keys:

| Feature | Needs | Without it |
|---|---|---|
| ⌘K agent (Q&A on /dashboard) | `GEMINI_API_KEY` | button is inert |
| Image / scanned-PDF OCR on upload | `GEMINI_API_KEY` | falls back to pdf-parse text only |
| Fact extraction quality | `ANTHROPIC_API_KEY` (optional) | bilingual heuristic extractor (works, slightly noisier) |
| /research baselines (long-context, RAG) | `ANTHROPIC_API_KEY` | rows show "no key configured" |

```bash
cp .env.example .env.local                      # then paste keys you have
```

### Reseeding from the hackathon dataset (maintainers only)

If you've checked out the original `hackathon-*.zip`:

```bash
unzip hackathon-*.zip -d tmp/                   # tmp/hackathon/{stammdaten,emails,briefe,rechnungen,bank,incremental}
node scripts/extract-pdf-texts.mjs              # one-time: pre-extracts text from 339 PDFs
rm data/hausbuch.db                             # delete the shipped snapshot
npm run dev                                     # seedIfEmpty rebuilds the DB on first request
```

To reset the live state to the shipped snapshot:

```bash
curl -X POST http://localhost:3000/api/reset    # truncates tables and re-seeds in place
```

## License

Hausbuch is released under the **[Business Source License 1.1](LICENSE)** —
source-available, *not* open source. In plain English:

| You may | You may not (until the Change Date) |
|---|---|
| Read the source | Use it in production at your company |
| Run it locally for evaluation, research, or learning | Run it as part of a paid product or hosted service you sell |
| Modify it for your own non-production experiments | Sell, sublicense, or monetize the code or any derivative |
| Share modified copies under the same license | Repackage it as your own startup's offering |

The license **automatically converts to Apache 2.0 on 2030-04-26** (the Change
Date), at which point all of the restrictions above lift and the code becomes
fully open source. Until then, any production / commercial use requires a
separate license — contact the author.

This is the same model used by Sentry, MariaDB, Couchbase, and HashiCorp
Terraform: open enough for evaluation, judging, and contribution; closed
enough that someone else can't trivially turn it into their commercial product.

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
