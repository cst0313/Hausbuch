// path: scripts/test-normalize.ts
// path: scripts/test-normalize.ts
import { normalizePredicate, aliasCoverage } from "../src/lib/normalize";

const tests = [
  "Eigentümer", "Eigentuemer", "Owner", "landlord", "MietEig",
  "Kontakt", "Ansprechpartner", "Hausverwaltung",
  "Mieter", "Tenant", "Grundmiete", "Kaltmiete", "monthly_rent",
  "Baujahr", "year_built", "Wohnfläche",
  "unknown_field",
  "identity.owner",
];
console.log("raw → canonical (known?)");
for (const raw of tests) {
  const r = normalizePredicate(raw);
  const mark = r.known ? "✓" : "·";
  console.log(`  ${mark} ${raw.padEnd(22)} → ${r.canonical}${r.aliased_from ? " (from " + r.aliased_from + ")" : ""}`);
}
const coverage = aliasCoverage();
console.log(`\ncoverage: ${coverage.length} canonical keys, ${coverage.reduce((a, b) => a + b.alias_count, 0)} aliases`);
console.log("\ntop-5 most-aliased canonical keys:");
for (const row of coverage.slice(0, 5)) {
  console.log(`  ${row.canonical.padEnd(28)} ${row.alias_count} aliases: ${row.aliases.slice(0, 6).join(", ")}${row.alias_count > 6 ? "…" : ""}`);
}
