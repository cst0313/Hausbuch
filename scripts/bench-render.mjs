// Compare token counts for two renderings of the same entity:
//   1. Hausbuch's structured Context.md (padded predicates, anchored blocks)
//   2. A plain-prose alternative ("Magrit Mitschke is the tenant of WE 32. Her
//      lease started 2024-08-01. The current rent is €1,617.73 / month...")
//
// The agent answers from whatever we hand it; cheaper tokens + cache-stable
// prefixes are direct savings. This script measures both modes against the
// live database for several entities and prints the deltas.
//
// Approximate "tokens" with: chars / 4. That tracks GPT-style tokenizers
// closely enough for an order-of-magnitude argument; what matters for the
// comparison is the ratio between formats, not the absolute token count.
//
// Usage:
//   1. boot the dev server (npm run dev)
//   2. node scripts/bench-render.mjs

const HOST = "http://localhost:3000";
const ENTITIES = [
  "weg:immanuelkirchstr-26",
  "tenant:MIE-016",
  "contractor:DL-001",
  "owner:EIG-001",
  "building:HAUS-12",
];

function tokens(s) { return Math.ceil(s.length / 4); }

function toProse(facts) {
  // Convert structured facts into a plain English narrative the way a human
  // would naively write it — full sentences, repeated subject, no anchoring.
  if (facts.length === 0) return "";
  const groups = new Map();
  for (const f of facts) {
    const top = f.predicate.split(".")[0];
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push(f);
  }
  const out = [];
  for (const [section, items] of groups) {
    out.push(`Regarding ${section}:`);
    for (const f of items) {
      const cite = f.span?.quote
        ? ` (according to a source which states: "${f.span.quote.slice(0, 80)}")`
        : "";
      const period =
        f.valid_from && f.valid_to && f.valid_from === f.valid_to
          ? ` This was true on ${f.valid_from.slice(0, 10)}.`
          : f.valid_from && f.valid_to
            ? ` This was valid from ${f.valid_from.slice(0, 10)} until ${f.valid_to.slice(0, 10)}.`
            : f.valid_from
              ? ` This became true on ${f.valid_from.slice(0, 10)}.`
              : "";
      out.push(
        `The ${f.predicate.split(".").slice(1).join(" ")} for this entity is ${f.value}${
          f.unit ? ` ${f.unit}` : ""
        }.${period}${cite}`,
      );
    }
    out.push("");
  }
  return out.join("\n");
}

async function bench(entity) {
  const r = await fetch(
    `${HOST}/api/context/${encodeURIComponent(entity)}?format=json&detail=3`,
  );
  if (!r.ok) {
    console.warn(`  skip ${entity}: HTTP ${r.status}`);
    return null;
  }
  const j = await r.json();
  const structured = j.markdown ?? "";
  const prose = toProse(j.facts ?? []);
  return {
    entity,
    facts: j.counts?.facts ?? 0,
    structuredChars: structured.length,
    structuredTokens: tokens(structured),
    proseChars: prose.length,
    proseTokens: tokens(prose),
  };
}

const rows = [];
for (const e of ENTITIES) {
  const row = await bench(e);
  if (row) rows.push(row);
}

console.log();
console.log(
  "entity".padEnd(34) +
    "facts".padEnd(8) +
    "structured".padEnd(14) +
    "prose".padEnd(14) +
    "saving",
);
console.log("─".repeat(82));
for (const r of rows) {
  const ratio = r.proseTokens / r.structuredTokens;
  const saving = `${(100 - 100 / ratio).toFixed(0)}% smaller`;
  console.log(
    r.entity.padEnd(34) +
      String(r.facts).padEnd(8) +
      `${r.structuredTokens} tok`.padEnd(14) +
      `${r.proseTokens} tok`.padEnd(14) +
      `${ratio.toFixed(2)}× · ${saving}`,
  );
}
console.log();

const totS = rows.reduce((a, b) => a + b.structuredTokens, 0);
const totP = rows.reduce((a, b) => a + b.proseTokens, 0);
const totF = rows.reduce((a, b) => a + b.facts, 0);
console.log(
  `TOTAL across ${rows.length} entities (${totF} facts):  ` +
    `${totS} structured  vs  ${totP} prose  ·  ${(totP / totS).toFixed(2)}× ratio`,
);
