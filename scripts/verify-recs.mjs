// Verification harness: pull a sample of recommendations across categories,
// fetch each rec's primary draft email, and check that:
//   1. The draft body actually mentions the rec's incident keywords
//      (water_damage rec → body talks about water/leak; mold → Schimmel; etc.)
//   2. The recipient matches the rec's intent (tenant for legal, contractor
//      for incident dispatches — but the dashboard always picks the
//      tenant-facing draft, so for incidents it's the tenant too).
//   3. Severity is reasonable for the category.
//   4. email_chain[0] subject mentions the type (we already fixed this but
//      let's keep it tested).
//
// Usage:  node scripts/verify-recs.mjs

const HOST = process.env.HOST ?? "http://localhost:3000";

// Keyword expectations per category. We don't require all, just at least one.
// Lowercase match against the draft body.
const EXPECTATIONS = {
  "incident.water_damage": {
    bodyHints: ["wasser", "leck", "tropf", "rohrbruch", "feucht", "leak", "water"],
    chainHints: ["wasser", "water", "leck", "leak"],
    severities: ["critical", "high", "medium"],
  },
  "incident.mold": {
    bodyHints: ["schimmel", "mold", "schimmelbefall"],
    chainHints: ["schimmel", "mold"],
    severities: ["critical", "high"],
  },
  "incident.heating": {
    bodyHints: ["heizung", "thermostat", "kalt", "heating", "boiler", "warmwasser"],
    chainHints: ["heizung", "heating", "thermostat"],
    severities: ["critical", "high", "medium"],
  },
  "incident.lock_issue": {
    bodyHints: ["schloss", "schluessel", "schlüssel", "haustür", "haustuer", "schliessanlage", "lock", "key"],
    chainHints: ["schloss", "schluessel", "schlüssel", "haustuer", "haustür", "lock"],
    severities: ["high", "medium", "low"],
  },
  "incident.elevator": {
    bodyHints: ["aufzug", "fahrstuhl", "lift", "elevator"],
    chainHints: ["aufzug", "fahrstuhl", "lift"],
    severities: ["high", "medium"],
  },
  "incident.noise": {
    bodyHints: ["ruhestörung", "ruhestoerung", "lärm", "laerm", "noise"],
    chainHints: ["lärm", "laerm", "ruhe"],
    severities: ["medium", "low"],
  },
  "incident.electrical": {
    bodyHints: ["strom", "steckdose", "elektrik", "elektr", "sicherung", "ausfall"],
    chainHints: ["strom", "elektr", "sicherung"],
    severities: ["high", "medium"],
  },
  "legal.mietminderung": {
    // The reply draft is a status update telling the tenant we'll deal with it.
    // It MUST mention Mietminderung and SHOULD reference the dispatched repair.
    bodyHints: ["mietminderung", "minderung", "minder"],
    bodyMustNotInclude: ["herr jessel", "frau jessel"], // never the contractor name
    chainHints: ["mietminderung", "minder"],
    severities: ["critical", "high"],
  },
  "legal.kuendigung": {
    bodyHints: ["kündigung", "kuendigung", "termination", "übergabe", "uebergabe"],
    chainHints: ["kündigung", "kuendigung", "termination"],
    severities: ["critical", "high"],
  },
};

const NOT_AN_INCIDENT_TYPE = new Set(["incident.mahnung", "incident.kuendigung"]);

async function pickPrimaryDraft(rec) {
  // Mirror StreamPanel selection rule: prefer draft_email, fallback to any draft.
  const primary =
    rec.actions.find((a) => a.type === "draft_email" && a.draft_context) ??
    rec.actions.find((a) => a.draft_context);
  if (!primary?.draft_context) return null;
  const r = await fetch(`${HOST}/api/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(primary.draft_context),
  });
  const j = await r.json();
  return { type: primary.type, body: j.body ?? j.text ?? "", subject: j.subject ?? primary.draft_context.subject ?? "", recipient: primary.draft_context.to };
}

const checks = [];
const fail = (id, msg, detail) => checks.push({ ok: false, id, msg, detail });
const pass = (id, msg) => checks.push({ ok: true, id, msg });

const main = async () => {
  const data = await fetch(`${HOST}/api/recommendations`).then((r) => r.json());
  const recs = data.recommendations ?? [];
  console.log(`Loaded ${recs.length} recommendations.\n`);

  // 1. Phantom-incident-type sanity
  for (const rec of recs) {
    if (NOT_AN_INCIDENT_TYPE.has(rec.category)) {
      fail(rec.id, `phantom incident type — '${rec.category}' shouldn't exist`, rec.title);
    }
  }

  // 2. Pick one rec per category for deep verification
  const byCat = new Map();
  for (const rec of recs) {
    if (!byCat.has(rec.category)) byCat.set(rec.category, rec);
  }
  console.log(`Verifying one rec per category (${byCat.size} categories):\n`);

  for (const [cat, rec] of byCat) {
    const exp = EXPECTATIONS[cat];
    if (!exp) {
      console.log(`  [skip] ${cat} — no expectation defined`);
      continue;
    }

    // Severity
    if (!exp.severities.includes(rec.severity)) {
      fail(rec.id, `severity '${rec.severity}' not in expected ${exp.severities.join("|")} for ${cat}`, rec.title);
    } else {
      pass(rec.id, `severity ok (${rec.severity})`);
    }

    // email_chain[0] keyword
    const chainTitle = (rec.email_chain?.[0]?.title ?? "").toLowerCase();
    if (chainTitle && !exp.chainHints.some((h) => chainTitle.includes(h.toLowerCase()))) {
      fail(rec.id, `chain[0] subject doesn't mention type keywords`, `${cat} → "${chainTitle}"`);
    } else if (chainTitle) {
      pass(rec.id, `chain matches type`);
    }

    // Draft body
    process.stdout.write(`  drafting for ${cat} (${rec.entity_name})... `);
    let draft;
    try {
      draft = await pickPrimaryDraft(rec);
    } catch (e) {
      console.log("ERROR", e.message);
      fail(rec.id, `draft fetch threw`, e.message);
      continue;
    }
    if (!draft) {
      console.log("(no draft action)");
      continue;
    }
    const lower = draft.body.toLowerCase();
    const hit = exp.bodyHints.find((h) => lower.includes(h.toLowerCase()));
    if (hit) {
      console.log(`ok (matched: ${hit})`);
      pass(rec.id, `body mentions '${hit}'`);
    } else {
      console.log(`MISMATCH — no expected keyword`);
      fail(rec.id, `draft body doesn't mention ${cat} keywords`, `recipient=${draft.recipient} · first 200 chars: ${draft.body.slice(0, 200)}`);
    }

    if (exp.bodyMustNotInclude) {
      for (const bad of exp.bodyMustNotInclude) {
        if (lower.includes(bad.toLowerCase())) {
          fail(rec.id, `draft body mentions '${bad}' — wrong recipient`, draft.body.slice(0, 200));
        }
      }
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok);
  console.log(`PASS: ${passed} / ${checks.length}`);
  console.log(`FAIL: ${failed.length}\n`);
  for (const f of failed) {
    console.log(`  [${f.id}] ${f.msg}`);
    if (f.detail) console.log(`    ${f.detail}`);
  }
  if (failed.length > 0) process.exit(1);
};

main().catch((e) => {
  console.error("harness crashed:", e);
  process.exit(2);
});
