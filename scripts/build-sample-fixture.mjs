// One-shot script: capture the curated sandbox subset from the live
// engine, save as a static fixture so /sandbox renders without a
// network round-trip. Re-run if the demo allowlist or rec engine
// logic changes.
//
//   node scripts/build-sample-fixture.mjs

import fs from "node:fs/promises";

const HOST = process.env.HOST ?? "http://localhost:3000";
const ALLOW = new Set([
  "tenant:MIE-017", // Edeltraud Renner
  "tenant:MIE-016", // Magrit Mitschke
  "tenant:MIE-008", // Ferenc Stahr
  "tenant:MIE-022", // Carsten Austermühle
  "tenant:MIE-018", // Louise Ladeck
]);
const REC_LIMIT = 6;
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

const data = await fetch(`${HOST}/api/recommendations`).then((r) => r.json());
const all = data.recommendations ?? [];
const filtered = all
  .filter((r) => ALLOW.has(r.entity_id))
  .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity])
  .slice(0, REC_LIMIT);

const summary = {
  files_total: filtered.length,
  files_processed: filtered.length,
  facts_added: filtered.reduce((n, r) => n + (r.facts?.length ?? 0), 0),
  entities_touched: new Set(filtered.map((r) => r.entity_id)).size,
  open_recs: filtered.length,
};

const fixture = {
  generated_at: new Date().toISOString(),
  summary,
  recommendations: filtered,
  info_only: [
    {
      title: "Schlüsselverlust report (Mitschke)",
      kind: "email",
      summary:
        "Tenant key-loss report — fact extracted (incident.type=lock_issue) but no critical action; folded into the open lock case.",
    },
    {
      title: "Quarterly water-utility invoice",
      kind: "invoice",
      summary:
        "Booked against the WEG account, no manager action — included so the comparison shows mixed-source ingestion.",
    },
  ],
};

const out = "public/sandbox/sample-bundle-recs.json";
await fs.writeFile(out, JSON.stringify(fixture, null, 2));
console.log(
  `wrote ${out}: ${filtered.length} recs across ${summary.entities_touched} entities`,
);
