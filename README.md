# Hausbuch

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
npm run dev    # http://localhost:3000
```

Seeds automatically on first request.

## Partner technologies

- **Google Gemini 2.5** — multimodal ingest (scanned leases, meter photos, assembly minutes) and default composer
- **Tavily** — live enrichment (Mietpreisbremse caps by ZIP, Handelsregister, contractor registry)
- **Gradium** — voice layer: "call your building"
- **Aikido** — security scanning (see `docs/security.md`)

## License

[Business Source License 1.1](LICENSE). Converts to Apache 2.0 on 2028-04-24.

---

_Built in Berlin, April 2026._
