// Meta-harness: measure render size + latency for Context.md, recs, agent.
// Single-run: prints baseline. Re-run after optimizations to see deltas.
//
// Usage:
//   node scripts/bench-harness.mjs          # default 3 iterations
//   ITERS=10 node scripts/bench-harness.mjs # custom

const HOST = process.env.HOST ?? "http://localhost:3000";
const ITERS = Number(process.env.ITERS ?? 3);

const ENTITIES = [
  "weg:immanuelkirchstr-26",
  "tenant:MIE-016",                // Magrit Mitschke
  "tenant:MIE-017",                // Edeltraud Renner — Mietminderung case
  "tenant:MIE-008",                // Ferenc Stahr — many incidents
  "contractor:DL-001",
  "owner:EIG-001",
  "building:HAUS-12",
];

const QUERIES = [
  "What's broken in WE 32?",
  "Has Edeltraud's water issue been resolved?",
  "Who lives in WE 32?",
  "How much rent does Ferenc Stahr pay?",
];

const tokens = (s) => Math.ceil(s.length / 4);
const fmt = (n) => n.toLocaleString("en-US");

async function timed(fn) {
  const t0 = performance.now();
  const r = await fn();
  return { ms: performance.now() - t0, r };
}

function stats(samples) {
  if (samples.length === 0) return { p50: 0, p95: 0, mean: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const mean = sorted.reduce((s, n) => s + n, 0) / sorted.length;
  return { p50, p95, mean };
}

async function getJSON(path) {
  const res = await fetch(`${HOST}${path}`);
  return res.json();
}

async function postJSON(path, body) {
  const res = await fetch(`${HOST}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

console.log(`== Hausbuch meta-harness · iters=${ITERS} · host=${HOST} ==\n`);

// ── 1. Context.md render: size + latency for default & detail levels ──────
console.log("[Context.md]   entity                          chars  tokens  detail   ms (p50/p95)");
for (const id of ENTITIES) {
  for (const detail of [1, 2, 3]) {
    const samples = [];
    let lastBytes = 0;
    let lastTokens = 0;
    for (let i = 0; i < ITERS; i++) {
      const { ms, r } = await timed(() => getJSON(`/api/context/${encodeURIComponent(id)}?detail=${detail}&format=json`));
      const md = r?.markdown ?? r?.context ?? "";
      lastBytes = md.length;
      lastTokens = tokens(md);
      samples.push(ms);
    }
    const s = stats(samples);
    console.log(
      `              ${id.padEnd(32)} ${String(fmt(lastBytes)).padStart(7)} ${String(fmt(lastTokens)).padStart(7)}  d=${detail}     ${s.p50.toFixed(0).padStart(4)} / ${s.p95.toFixed(0).padStart(4)}`,
    );
  }
}

// ── 2. /api/recommendations latency ───────────────────────────────────────
console.log("\n[Recs]");
{
  const samples = [];
  let count = 0;
  for (let i = 0; i < ITERS; i++) {
    const { ms, r } = await timed(() => getJSON(`/api/recommendations`));
    count = (r?.recommendations ?? []).length;
    samples.push(ms);
  }
  const s = stats(samples);
  console.log(`              ${count} recs                          ${s.p50.toFixed(0).padStart(4)} / ${s.p95.toFixed(0).padStart(4)} ms (p50/p95)`);
}

// ── 3. /api/stats latency (cheap sanity) ──────────────────────────────────
console.log("\n[Stats]");
{
  const samples = [];
  for (let i = 0; i < ITERS; i++) {
    const { ms } = await timed(() => getJSON(`/api/stats`));
    samples.push(ms);
  }
  const s = stats(samples);
  console.log(`              /api/stats                          ${s.p50.toFixed(0).padStart(4)} / ${s.p95.toFixed(0).padStart(4)} ms (p50/p95)`);
}

// ── 4. Agent latency (the slowest, LLM-bound) ─────────────────────────────
console.log("\n[Agent]");
for (const q of QUERIES) {
  const samples = [];
  let factsUsed = 0;
  let entitiesAccessed = 0;
  for (let i = 0; i < ITERS; i++) {
    const { ms, r } = await timed(() => postJSON(`/api/agent`, { message: q }));
    factsUsed = r?.facts_used ?? 0;
    entitiesAccessed = (r?.entities_accessed ?? []).length;
    samples.push(ms);
  }
  const s = stats(samples);
  console.log(
    `              "${q.slice(0, 36).padEnd(36)}" facts=${String(factsUsed).padStart(4)} ents=${entitiesAccessed}  ${s.p50.toFixed(0).padStart(5)} / ${s.p95.toFixed(0).padStart(5)} ms`,
  );
}

console.log("\nDone.");
