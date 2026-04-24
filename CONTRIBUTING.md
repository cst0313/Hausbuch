# Contributing to Hausbuch

Thanks for the interest. A few notes on the shape of this project before you open a PR.

## What Hausbuch is

A context engine for property management. One living, self-updating, citation-backed `Context.md` per building. Dense, structured, traced to its source, surgically updated without destroying human edits.

## What Hausbuch is not

- A RAG wrapper
- A documentation chatbot
- A database schema anyone should copy without understanding the bitemporal model

## Ground rules

1. **No synthetic data in claims.** If a benchmark number is shown on `/research`, it comes from a live API call. Do not hardcode plausible-sounding numbers.
2. **Honest labelling.** Any fallback path must say so in its `model` field (`compose-fallback`, `-simulated`, `(projected)`).
3. **Don't touch the cache-critical ordering** in `src/lib/renderer.ts`. Section order is fixed for prompt-cache stability.
4. **Don't simplify the reconciler's `sameValueOld` / `differentValueOld` partition.** It is the thing that lets conflicts survive into the rendered document.

## Local setup

```bash
npm install
npm run dev    # http://localhost:3000
```

The SQLite database seeds automatically from `src/lib/seed.ts` on the first request.

## License

This project is licensed under the Business Source License 1.1. See [LICENSE](LICENSE). By submitting a contribution you agree it may be distributed under the same terms.
