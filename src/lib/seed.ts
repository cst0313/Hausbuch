// path: src/lib/seed.ts
/**
 * Seed from the hackathon WEG dataset (Immanuelkirchstraße 26, Berlin 10405).
 *
 * Loads stammdaten.json and creates entities + facts for:
 *   1 WEG (Liegenschaft), 3 buildings, 52 units,
 *   35 owners, 26 tenants, 16 contractors.
 *
 * Then bulk-imports all historical emails (6,546) and the 10-day incremental set
 * as sources with thread tracking, plus bank transactions as financial facts.
 */

import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { Entity, Fact, Source, SourceKind } from "./types";
import {
  ident,
  insertEntity,
  insertSource,
  insertFact,
  logEvent,
  newFactId,
  newSourceId,
} from "./db";
import { classifyEmailIncident } from "./classify";

// Emails where keyword scoring couldn't pick an incident type but the
// category metadata says it IS an incident. We collect them during the
// sync seed pass and classify with Gemini after the transaction commits.
type PendingClassification = {
  entityId: string;
  sourceId: string;
  subject: string;
  body: string;
  ingested_at: string;
};
const pendingClassifications: PendingClassification[] = [];

// ── Default entity for backwards compat ─────────────────────────────────────

export const ENTITY = "weg:immanuelkirchstr-26";

// ── Hackathon data path ─────────────────────────────────────────────────────

const HACKATHON_DIR = path.resolve(process.cwd(), "tmp", "hackathon");
const STAMMDATEN_PATH = path.join(HACKATHON_DIR, "stammdaten", "stammdaten.json");

// ── Types matching stammdaten.json ──────────────────────────────────────────

type Liegenschaft = {
  id: string; name: string; strasse: string; plz: string; ort: string;
  baujahr: number; sanierung: number;
  verwalter: string; verwalter_strasse: string; verwalter_plz: string;
  verwalter_ort: string; verwalter_email: string; verwalter_telefon: string;
};

type Gebaeude = {
  id: string; hausnr: string; einheiten: number; etagen: number;
  fahrstuhl: boolean; baujahr: number;
};

type Einheit = {
  id: string; haus_id: string; einheit_nr: string; lage: string;
  typ: string; wohnflaeche_qm: number; zimmer: number;
  miteigentumsanteil: number;
};

type Eigentuemer = {
  id: string; anrede: string; vorname: string; nachname: string;
  firma: string | null; strasse: string; plz: string; ort: string;
  land: string; email: string; telefon: string;
  einheit_ids: string[]; selbstnutzer: boolean;
  sev_mandat: boolean; beirat: boolean; sprache: string;
};

type Mieter = {
  id: string; anrede: string; vorname: string; nachname: string;
  email: string; telefon: string; einheit_id: string;
  eigentuemer_id: string; mietbeginn: string; mietende: string | null;
  kaltmiete: number; nk_vorauszahlung: number; kaution: number;
  sprache: string;
};

type Dienstleister = {
  id: string; firma: string; branche: string; ansprechpartner: string;
  email: string; telefon: string; strasse: string; plz: string;
  ort: string; land: string;
  vertrag_monatlich: number; stundensatz: number;
};

type Stammdaten = {
  liegenschaft: Liegenschaft;
  gebaeude: Gebaeude[];
  einheiten: Einheit[];
  eigentuemer: Eigentuemer[];
  mieter: Mieter[];
  dienstleister: Dienstleister[];
};

// ── Seed entry point ────────────────────────────────────────────────────────

export function seedIfEmpty(database: Database.Database): void {
  const count = database.prepare("SELECT COUNT(*) as n FROM entities").get() as { n: number };
  if (count.n > 0) return;

  if (!fs.existsSync(STAMMDATEN_PATH)) {
    console.warn(`[hausbuch] stammdaten not found at ${STAMMDATEN_PATH} — seeding with minimal data`);
    seedMinimal();
    return;
  }

  console.log("[hausbuch] seeding from hackathon stammdaten...");
  const data: Stammdaten = JSON.parse(fs.readFileSync(STAMMDATEN_PATH, "utf8"));
  const now = new Date().toISOString();

  const tx = database.transaction(() => {
    seedWeg(data.liegenschaft, now);
    seedBuildings(data.gebaeude, now);
    seedUnits(data.einheiten, now);
    seedOwners(data.eigentuemer, now);
    seedTenants(data.mieter, data.einheiten, now);
    seedContractors(data.dienstleister, now);
  });
  tx();

  // Bulk imports run outside the main transaction (they're large)
  importEmails(data);
  importBankTransactions();
  importPdfs(data);

  const entityCount = database.prepare("SELECT COUNT(*) as n FROM entities").get() as { n: number };
  const factCount = database.prepare("SELECT COUNT(*) as n FROM facts").get() as { n: number };
  const sourceCount = database.prepare("SELECT COUNT(*) as n FROM sources").get() as { n: number };
  console.log(`[hausbuch] seed complete: ${entityCount.n} entities, ${factCount.n} facts, ${sourceCount.n} sources`);

  // Fire-and-forget LLM classification for ambiguous incident emails.
  // Capped + async so seed returns immediately; facts trickle in over the next
  // ~30s. The home/dashboard auto-refresh picks them up on the next /api/stats poll.
  if (pendingClassifications.length > 0) {
    void classifyPending();
  }
}

async function classifyPending(): Promise<void> {
  const MAX = 30; // hard cap so we don't burn quota on a flood of indexed emails
  const queue = pendingClassifications.splice(0, MAX);
  console.log(`[hausbuch] LLM-classifying ${queue.length} ambiguous incident emails…`);
  let resolved = 0;
  for (const item of queue) {
    const type = await classifyEmailIncident(item.subject, item.body);
    if (type && type !== "other") {
      writeFact(item.entityId, "incident.type", type, item.sourceId, item.body.slice(0, 120), item.ingested_at);
      writeFact(item.entityId, "incident.status", "reported", item.sourceId, "gemeldet (LLM-classified)", item.ingested_at);
      resolved++;
    }
  }
  console.log(`[hausbuch] LLM classification done: ${resolved}/${queue.length} resolved`);
}

// ── WEG (Liegenschaft) ──────────────────────────────────────────────────────

function seedWeg(l: Liegenschaft, now: string): void {
  const entityId = ENTITY;
  insertEntity({
    id: entityId, type: "weg", name: l.name,
    parent_id: null,
    meta: { plz: l.plz, ort: l.ort, strasse: l.strasse, baujahr: l.baujahr },
    created_at: now,
  });

  const src = makeStammdatenSource(`stammdaten:weg:${l.id}`, `Stammdaten: ${l.name}`, now);
  insertSource(src);

  const facts: Array<[string, string | number | null, string?]> = [
    ["identity.name", l.name],
    ["identity.address", `${l.strasse}, ${l.plz} ${l.ort}`],
    ["identity.baujahr", l.baujahr],
    ["identity.sanierung", l.sanierung],
    ["contacts.verwalter", l.verwalter],
    ["contacts.verwalter.email", l.verwalter_email],
    ["contacts.verwalter.telefon", l.verwalter_telefon],
    ["contacts.verwalter.address", `${l.verwalter_strasse}, ${l.verwalter_plz} ${l.verwalter_ort}`],
  ];
  for (const [pred, val] of facts) {
    writeFact(entityId, pred, val ?? null, src.id, String(val ?? ""), now);
  }
}

// ── Buildings ───────────────────────────────────────────────────────────────

function seedBuildings(buildings: Gebaeude[], now: string): void {
  for (const g of buildings) {
    const entityId = `building:${g.id}`;
    insertEntity({
      id: entityId, type: "building", name: `Haus ${g.hausnr}`,
      parent_id: ENTITY,
      meta: { hausnr: g.hausnr, etagen: g.etagen, fahrstuhl: g.fahrstuhl },
      created_at: now,
    });

    const src = makeStammdatenSource(`stammdaten:building:${g.id}`, `Stammdaten: Haus ${g.hausnr}`, now);
    insertSource(src);

    writeFact(entityId, "identity.hausnr", g.hausnr, src.id, g.hausnr, now);
    writeFact(entityId, "identity.einheiten", g.einheiten, src.id, String(g.einheiten), now);
    writeFact(entityId, "identity.etagen", g.etagen, src.id, String(g.etagen), now);
    writeFact(entityId, "identity.fahrstuhl", g.fahrstuhl ? "true" : "false", src.id, g.fahrstuhl ? "ja" : "nein", now);
    writeFact(entityId, "identity.baujahr", g.baujahr, src.id, String(g.baujahr), now);
  }
}

// ── Units ───────────────────────────────────────────────────────────────────

function seedUnits(units: Einheit[], now: string): void {
  for (const u of units) {
    const entityId = `unit:${u.id}`;
    insertEntity({
      id: entityId, type: "unit", name: u.einheit_nr,
      parent_id: `building:${u.haus_id}`,
      meta: { lage: u.lage, typ: u.typ, flaeche: u.wohnflaeche_qm, zimmer: u.zimmer },
      created_at: now,
    });

    const src = makeStammdatenSource(`stammdaten:unit:${u.id}`, `Stammdaten: ${u.einheit_nr}`, now);
    insertSource(src);

    writeFact(entityId, "unit.number", u.einheit_nr, src.id, u.einheit_nr, now);
    writeFact(entityId, "unit.lage", u.lage, src.id, u.lage, now);
    writeFact(entityId, "unit.typ", u.typ, src.id, u.typ, now);
    writeFact(entityId, "unit.flaeche", u.wohnflaeche_qm, src.id, `${u.wohnflaeche_qm} m²`, now, "m²");
    writeFact(entityId, "unit.zimmer", u.zimmer, src.id, String(u.zimmer), now);
    writeFact(entityId, "unit.miteigentumsanteil", u.miteigentumsanteil, src.id, String(u.miteigentumsanteil), now);
    writeFact(entityId, "unit.building", u.haus_id, src.id, `Haus ${u.haus_id}`, now);
  }
}

// ── Owners ──────────────────────────────────────────────────────────────────

function seedOwners(owners: Eigentuemer[], now: string): void {
  for (const e of owners) {
    const entityId = `owner:${e.id}`;
    const displayName = e.firma || `${e.anrede} ${e.vorname} ${e.nachname}`;
    insertEntity({
      id: entityId, type: "owner", name: displayName,
      meta: { anrede: e.anrede, vorname: e.vorname, nachname: e.nachname, firma: e.firma },
      created_at: now,
    });

    const src = makeStammdatenSource(`stammdaten:owner:${e.id}`, `Stammdaten: ${displayName}`, now);
    insertSource(src);

    writeFact(entityId, "identity.name", `${e.vorname} ${e.nachname}`, src.id, `${e.vorname} ${e.nachname}`, now);
    if (e.firma) writeFact(entityId, "identity.firma", e.firma, src.id, e.firma, now);
    writeFact(entityId, "identity.email", e.email, src.id, e.email, now);
    writeFact(entityId, "identity.telefon", e.telefon, src.id, e.telefon, now);
    writeFact(entityId, "identity.address", `${e.strasse}, ${e.plz} ${e.ort}`, src.id, `${e.strasse}, ${e.plz} ${e.ort}`, now);
    writeFact(entityId, "identity.selbstnutzer", e.selbstnutzer ? "true" : "false", src.id, e.selbstnutzer ? "ja" : "nein", now);
    writeFact(entityId, "identity.sev_mandat", e.sev_mandat ? "true" : "false", src.id, e.sev_mandat ? "ja" : "nein", now);
    writeFact(entityId, "identity.beirat", e.beirat ? "true" : "false", src.id, e.beirat ? "ja" : "nein", now);

    // Cross-reference: which units does this owner own?
    for (const unitId of e.einheit_ids) {
      writeFact(entityId, "ownership.unit", unitId, src.id, unitId, now);
      // Also write on the unit: who owns it
      writeFact(`unit:${unitId}`, "unit.owner", e.id, src.id, displayName, now);
    }
  }
}

// ── Tenants ─────────────────────────────────────────────────────────────────

function seedTenants(tenants: Mieter[], units: Einheit[], now: string): void {
  for (const m of tenants) {
    const entityId = `tenant:${m.id}`;
    const displayName = `${m.anrede} ${m.vorname} ${m.nachname}`;
    insertEntity({
      id: entityId, type: "tenant", name: displayName,
      meta: { anrede: m.anrede, vorname: m.vorname, nachname: m.nachname },
      created_at: now,
    });

    const src = makeStammdatenSource(`stammdaten:tenant:${m.id}`, `Stammdaten: ${displayName}`, now);
    insertSource(src);

    writeFact(entityId, "identity.name", `${m.vorname} ${m.nachname}`, src.id, `${m.vorname} ${m.nachname}`, now);
    writeFact(entityId, "identity.email", m.email, src.id, m.email, now);
    writeFact(entityId, "identity.telefon", m.telefon, src.id, m.telefon, now);
    writeFact(entityId, "tenancy.unit", m.einheit_id, src.id, m.einheit_id, now);
    writeFact(entityId, "tenancy.owner", m.eigentuemer_id, src.id, m.eigentuemer_id, now);
    writeFact(entityId, "tenancy.start", m.mietbeginn, src.id, m.mietbeginn, now, undefined, m.mietbeginn);
    if (m.mietende) writeFact(entityId, "tenancy.end", m.mietende, src.id, m.mietende, now, undefined, m.mietende);
    writeFact(entityId, "tenancy.kaltmiete", m.kaltmiete, src.id, `€${m.kaltmiete.toFixed(2)}`, now, "EUR/month");
    writeFact(entityId, "tenancy.nebenkosten", m.nk_vorauszahlung, src.id, `€${m.nk_vorauszahlung.toFixed(2)}`, now, "EUR/month");
    writeFact(entityId, "tenancy.kaution", m.kaution, src.id, `€${m.kaution.toFixed(2)}`, now, "EUR");

    // Cross-reference: write tenant on the unit
    writeFact(`unit:${m.einheit_id}`, "unit.tenant", m.id, src.id, displayName, now, undefined, m.mietbeginn);

    // Also write rent fact on the unit
    writeFact(`unit:${m.einheit_id}`, "tenancy.rent.base", m.kaltmiete, src.id, `€${m.kaltmiete.toFixed(2)}/month`, now, "EUR/month", m.mietbeginn);
  }
}

// ── Contractors ─────────────────────────────────────────────────────────────

function seedContractors(contractors: Dienstleister[], now: string): void {
  for (const d of contractors) {
    const entityId = `contractor:${d.id}`;
    insertEntity({
      id: entityId, type: "contractor", name: d.firma,
      meta: { branche: d.branche, ansprechpartner: d.ansprechpartner },
      created_at: now,
    });

    const src = makeStammdatenSource(`stammdaten:contractor:${d.id}`, `Stammdaten: ${d.firma}`, now);
    insertSource(src);

    writeFact(entityId, "identity.firma", d.firma, src.id, d.firma, now);
    writeFact(entityId, "identity.branche", d.branche, src.id, d.branche, now);
    writeFact(entityId, "identity.ansprechpartner", d.ansprechpartner, src.id, d.ansprechpartner, now);
    writeFact(entityId, "identity.email", d.email, src.id, d.email, now);
    writeFact(entityId, "identity.telefon", d.telefon, src.id, d.telefon, now);
    writeFact(entityId, "identity.address", `${d.strasse}, ${d.plz} ${d.ort}`, src.id, `${d.strasse}, ${d.plz} ${d.ort}`, now);
    if (d.vertrag_monatlich > 0) writeFact(entityId, "contract.monthly", d.vertrag_monatlich, src.id, `€${d.vertrag_monatlich.toFixed(2)}`, now, "EUR/month");
    if (d.stundensatz > 0) writeFact(entityId, "contract.hourly_rate", d.stundensatz, src.id, `€${d.stundensatz.toFixed(2)}`, now, "EUR/hour");
  }
}

// ── Email bulk import ───────────────────────────────────────────────────────

function importEmails(data: Stammdaten): void {
  // Build email → entity lookup from stammdaten
  const emailToEntity = new Map<string, string>();
  emailToEntity.set(data.liegenschaft.verwalter_email, ENTITY);
  for (const e of data.eigentuemer) emailToEntity.set(e.email, `owner:${e.id}`);
  for (const m of data.mieter) emailToEntity.set(m.email, `tenant:${m.id}`);
  for (const d of data.dienstleister) emailToEntity.set(d.email, `contractor:${d.id}`);

  // Import historical emails (pre-2026 archive)
  const emailsDir = path.join(HACKATHON_DIR, "emails");
  if (fs.existsSync(emailsDir)) {
    let count = 0;
    const months = fs.readdirSync(emailsDir).filter(d => !d.startsWith(".")).sort();
    for (const month of months) {
      const monthDir = path.join(emailsDir, month);
      if (!fs.statSync(monthDir).isDirectory()) continue;
      const files = fs.readdirSync(monthDir).filter(f => f.endsWith(".eml"));
      for (const file of files) {
        const filePath = path.join(monthDir, file);
        importSingleEmail(filePath, file, emailToEntity);
        count++;
      }
    }
    console.log(`[hausbuch] imported ${count} historical emails`);
  }

  // Import incremental emails (10-day scenario)
  const incrDir = path.join(HACKATHON_DIR, "incremental");
  if (fs.existsSync(incrDir)) {
    let count = 0;
    const days = fs.readdirSync(incrDir).filter(d => d.startsWith("day-")).sort();
    for (const day of days) {
      const dayDir = path.join(incrDir, day);
      // Read index for category + thread info
      const indexPath = path.join(dayDir, "emails_index.csv");
      const emailIndex = fs.existsSync(indexPath) ? parseEmailIndex(indexPath) : new Map();

      // Incremental emails live at: incremental/day-XX/emails/MONTH/FILE.eml
      for (const [, meta] of emailIndex) {
        const filename = meta.filename;
        if (!filename) continue;
        const monthDir = meta.month_dir ?? "";
        const candidates = [
          path.join(dayDir, "emails", monthDir, filename),
          path.join(dayDir, filename),
          path.join(HACKATHON_DIR, "emails", monthDir, filename),
        ];
        let imported = false;
        for (const p of candidates) {
          if (fs.existsSync(p)) {
            importSingleEmail(p, filename, emailToEntity, meta);
            count++;
            imported = true;
            break;
          }
        }
        if (!imported) {
          // Still record the metadata as a source even without the file
          const entityId = emailToEntity.get(meta.id ?? "") ?? ENTITY;
          const sourceId = newSourceId(filename);
          insertSource({
            id: sourceId, kind: "email", title: meta.subject ?? filename,
            ingested_at: new Date().toISOString(),
            raw_excerpt: `[Subject: ${meta.subject ?? filename}]`,
            source_prior: 0.7,
            entity_id: entityId,
            thread_id: meta.thread_id,
            category: meta.category,
            direction: meta.direction,
            from_addr: meta.id,
          });
        }
      }
    }
    console.log(`[hausbuch] imported ${count} incremental emails`);
  }
}

type EmailMeta = {
  id?: string;
  thread_id?: string;
  direction?: "incoming" | "outgoing";
  category?: string;
  filename?: string;
  month_dir?: string;
  subject?: string;
};

function parseEmailIndex(csvPath: string): Map<string, EmailMeta> {
  const map = new Map<string, EmailMeta>();
  const lines = fs.readFileSync(csvPath, "utf8").split("\n");
  if (lines.length < 2) return map;
  const headers = lines[0].split(",");
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 2) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < cols.length; j++) {
      row[headers[j].trim()] = cols[j].trim();
    }
    map.set(row.id ?? "", {
      id: row.id,
      thread_id: row.thread_id,
      direction: (row.direction as "incoming" | "outgoing") || undefined,
      category: row.category,
      filename: row.filename,
      month_dir: row.month_dir,
      subject: row.subject,
    });
  }
  return map;
}

function importSingleEmail(
  filePath: string,
  filename: string,
  emailToEntity: Map<string, string>,
  meta?: EmailMeta,
): void {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const headers = parseEmailHeaders(raw);
    const body = extractEmailBody(raw);

    // Resolve entity from sender/recipient email
    const fromAddr = headers.from_email ?? meta?.id ?? "";
    const toAddr = headers.to_email ?? "";
    // For incoming: the entity is the sender (tenant/owner/contractor)
    // For outgoing: the entity is the recipient
    const direction = meta?.direction ?? (fromAddr.includes("huber-partner") ? "outgoing" : "incoming");
    const relevantAddr = direction === "incoming" ? fromAddr : toAddr;
    const entityId = emailToEntity.get(relevantAddr) ?? ENTITY;

    const sourceId = newSourceId(filename);
    const source: Source = {
      id: sourceId,
      kind: "email",
      title: headers.subject || filename,
      ingested_at: headers.date || new Date().toISOString(),
      raw_excerpt: body.slice(0, 4096),
      source_prior: 0.7,
      entity_id: entityId,
      thread_id: meta?.thread_id,
      category: meta?.category,
      direction,
      from_addr: fromAddr,
      to_addr: toAddr,
    };
    insertSource(source);

    // Extract basic facts from the email based on category
    extractEmailFacts(entityId, source, body, meta?.category);
  } catch {
    // Skip malformed emails silently
  }
}

function parseEmailHeaders(raw: string): { from_email?: string; to_email?: string; subject?: string; date?: string } {
  const headerEnd = raw.indexOf("\n\n");
  const headerBlock = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw.slice(0, 500);
  // Unfold continuation lines
  const unfolded = headerBlock.replace(/\r?\n\s+/g, " ");

  const fromMatch = unfolded.match(/^From:\s*.*?<?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+)>?/im);
  const toMatch = unfolded.match(/^To:\s*.*?<?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+)>?/im);
  const subjMatch = unfolded.match(/^Subject:\s*(.+)/im);
  const dateMatch = unfolded.match(/^Date:\s*(.+)/im);

  return {
    from_email: fromMatch?.[1]?.toLowerCase(),
    to_email: toMatch?.[1]?.toLowerCase(),
    subject: subjMatch?.[1]?.trim().replace(/=\?utf-8\?q\?(.*?)\?=/gi, (_, enc) =>
      enc.replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16))).replace(/_/g, " ")
    ),
    date: dateMatch?.[1]?.trim() ? new Date(dateMatch[1].trim()).toISOString() : undefined,
  };
}

function extractEmailBody(raw: string): string {
  const idx = raw.indexOf("\n\n");
  if (idx < 0) return raw;
  return raw.slice(idx + 2)
    .replace(/=\r?\n/g, "") // quoted-printable soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .trim();
}

function extractEmailFacts(entityId: string, source: Source, body: string, category?: string): void {
  const now = source.ingested_at;
  const text = (body + " " + (source.title ?? "")).toLowerCase();
  const cat = (category ?? "").toLowerCase();

  // ── Incident detection ─────────────────────────────────────────────
  // Score each candidate type by counting keyword matches across body+title;
  // pick the highest-scoring type. Ties break in priority order. This avoids
  // the previous bug where an email mentioning "Wasser tropft am Aufzug"
  // got classified as `elevator` because the linear-priority OR-chain didn't
  // weigh the water signal more heavily.
  const isSchaden = cat.includes("schaden") || cat.includes("mangel");
  const PATTERNS: Array<[string, RegExp[]]> = [
    [
      "water_damage",
      [
        /\bwasser\b/i,
        /\bwasserschaden\b/i,
        /\bfeucht/i,
        /\bn(?:a|ä)sse\b/i,
        /\bnass\b/i,
        /\bdurchn(?:a|ä)sst/i,
        /\btropf/i, // tropft, tropfen, Tropfen
        /\bleck/i,
        /\bleckage/i,
        /\bundicht/i,
        /\brohrbruch/i,
        /\bwasserrohr/i,
        /\b(?:ü|ue)berschw(?:emm|emm)/i,
        /\bdecke[^.]*?(?:tropf|nass|undicht|wasser)/i,
        /\bwater\b/i,
        /\bleak/i,
        /\bflood/i,
      ],
    ],
    ["mold", [/\bschimmel/i, /\bschimmelbefall/i, /\bmold\b/i, /\bmildew/i]],
    [
      "heating",
      [/\bheizung/i, /\bthermostat/i, /\bkalt[^.]{0,30}wohn/i, /\bheating\b/i, /\bboiler/i],
    ],
    [
      "lock_issue",
      [
        /\bschloss/i,
        /\bschl(?:ü|ue)ssel/i,
        /\btuer.*schliesst/i,
        /\bhaustuer/i,
        /\bschlie(?:ß|ss)anlage/i,
        /\block\b/i,
        /\bkey\b/i,
      ],
    ],
    ["elevator", [/\baufzug/i, /\belevator/i, /\bfahrstuhl/i, /\blift\b/i]],
    ["noise", [/\bruhest(?:ö|oe)rung/i, /\bl(?:ä|ae)rm\b/i, /\bnoise\b/i]],
  ];

  const scored = PATTERNS.map(([type, regs]) => ({
    type,
    score: regs.reduce((n, r) => n + (r.test(text) ? 1 : 0), 0),
  })).filter((x) => x.score > 0);

  // Require either an explicit Schaden/Mangel category OR strong evidence
  // (≥2 keyword hits, OR the keyword(s) live in the email subject — subject
  // lines are intentional, body mentions can be off-hand). Prevents emails
  // that briefly mention "tuer" or "wasser" in passing from being filed as
  // a real incident.
  const subject = (source.title ?? "").toLowerCase();
  const subjectMatchedType = scored.find((s) => {
    const regs = PATTERNS.find(([t]) => t === s.type)?.[1] ?? [];
    return regs.some((r) => r.test(subject));
  });
  const top = scored.sort((a, b) => b.score - a.score)[0];
  const hasStrongSignal = isSchaden || !!subjectMatchedType || (top && top.score >= 2);

  if (hasStrongSignal && scored.length > 0) {
    const type = subjectMatchedType?.type ?? top.type;
    writeFact(entityId, "incident.type", type, source.id, body.slice(0, 120), now);
    writeFact(entityId, "incident.status", "reported", source.id, "gemeldet", now);
  } else if (isSchaden) {
    // Category says it's an incident but keywords didn't recognize the type.
    // Defer to LLM (post-seed) so the user gets coverage on paraphrased reports.
    pendingClassifications.push({
      entityId,
      sourceId: source.id,
      subject: source.title ?? "",
      body,
      ingested_at: now,
    });
  }

  // ── Legal issues ────────────────────────────────────────────────────
  // Strong signals only — a passing mention of "Kündigung" in a quoted reply
  // thread or a signature should NOT mark the entity as having terminated
  // their lease. Require: explicit category, OR subject keyword, OR an
  // unambiguous first-person phrase in the body.
  const subjectHasKuendigung = /k(?:ü|ue)ndigung/i.test(subject);
  const bodyHasKuendigungIntent = /\b(?:hiermit\s+)?(?:k(?:ü|ue)ndige|k(?:ü|ue)ndigen?\s+(?:wir|hiermit))\b|fristgerecht.*k(?:ü|ue)ndig|mietvertrag.*k(?:ü|ue)ndig/i.test(body);
  if (cat.includes("kuendigung") || subjectHasKuendigung || bodyHasKuendigungIntent) {
    writeFact(entityId, "legal.kuendigung", "true", source.id, body.slice(0, 120), now);
  }

  const subjectHasMietminderung = /mietminderung|minderung\s+der\s+miete/i.test(subject);
  const bodyHasMietminderungIntent = /\bmietminderung\b|\bmiete\s+(?:um|von)\s+\d+\s*%\s+minder|\bich\s+werde\s+die\s+miete.*mindern/i.test(body);
  if (cat.includes("mietminderung") || subjectHasMietminderung || bodyHasMietminderungIntent) {
    writeFact(entityId, "legal.mietminderung", "true", source.id, body.slice(0, 120), now);
    const pctMatch = body.match(/(\d{1,2})\s*%/);
    if (pctMatch) writeFact(entityId, "legal.mietminderung.prozent", Number(pctMatch[1]), source.id, `${pctMatch[1]}%`, now);
  }

  // Sonderumlage: only when subject mentions it OR body has "Einspruch gegen ... Sonderumlage"
  const subjectHasSonderumlage = /sonderumlage/i.test(subject);
  if (subjectHasSonderumlage || /einspruch[^.]*sonderumlage|sonderumlage[^.]*einspruch/i.test(body)) {
    writeFact(entityId, "legal.sonderumlage_dispute", "true", source.id, body.slice(0, 120), now);
  }

  // ── Financial ───────────────────────────────────────────────────────
  if (cat.includes("rechnung") || /rechnung|invoice|RE-\d{4}/i.test(text)) {
    const amtMatch = body.match(/(\d{1,6}[.,]\d{2})\s*(?:EUR|€)/);
    if (amtMatch) writeFact(entityId, "financial.invoice.amount", amtMatch[1].replace(",", "."), source.id, `€${amtMatch[1]}`, now, "EUR");
  }

  if (cat.includes("mahnung") || /mahnung|overdue|zahlungserinnerung/i.test(text)) {
    writeFact(entityId, "financial.mahnung", "true", source.id, body.slice(0, 120), now);
  }

  // ── Ownership / property changes ────────────────────────────────────
  if (/verkauf|sale|verkaufsabsicht/i.test(text)) {
    writeFact(entityId, "legal.verkaufsabsicht", "true", source.id, body.slice(0, 120), now);
  }

  if (/mieterwechsel|tenant.*change/i.test(text)) {
    writeFact(entityId, "tenancy.mieterwechsel", "true", source.id, body.slice(0, 120), now);
  }

  // Always record a communication fact so the email shows up in context
  writeFact(entityId, "communication.email", source.id, source.id, source.title, now);
}

// ── Bank transaction import ─────────────────────────────────────────────────

function importBankTransactions(): void {
  const bankIndexPath = path.join(HACKATHON_DIR, "bank", "bank_index.csv");
  if (!fs.existsSync(bankIndexPath)) return;

  const lines = fs.readFileSync(bankIndexPath, "utf8").split("\n");
  if (lines.length < 2) return;
  const headers = lines[0].split(",");

  let count = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 3) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length && j < cols.length; j++) {
      row[headers[j].trim()] = cols[j].trim();
    }

    const txId = row.id;
    const date = row.datum;
    const type = row.typ;
    const amount = parseFloat(row.betrag || "0");
    const category = row.kategorie;
    const counterparty = row.gegen_name;
    const purpose = row.verwendungszweck;
    const refId = row.referenz_id;

    if (!txId || !date) continue;

    // Determine which entity this transaction relates to
    let entityId = ENTITY;
    if (refId?.startsWith("MIE-")) entityId = `tenant:${refId}`;
    else if (refId?.startsWith("DL-")) entityId = `contractor:${refId}`;

    const sourceId = `src:bank:${txId}`;
    try {
      insertSource({
        id: sourceId,
        kind: "bank",
        title: `${type === "CREDIT" ? "↓" : "↑"} ${purpose}`,
        ingested_at: `${date}T12:00:00Z`,
        raw_excerpt: `${date} | ${type} | €${amount.toFixed(2)} | ${counterparty} | ${purpose}`,
        source_prior: 0.95,
        entity_id: entityId,
        category: category,
      });

      writeFact(entityId, `financial.${category || "transaction"}`, amount, sourceId, `€${amount.toFixed(2)} — ${purpose}`, `${date}T12:00:00Z`, type === "CREDIT" ? "EUR" : "EUR", date);
      count++;
    } catch {
      // Skip duplicates silently
    }
  }
  console.log(`[hausbuch] imported ${count} bank transactions`);
}

// ── PDF import (briefe + rechnungen + incremental letters) ──────────────────

type PdfText = { file: string; text: string; bytes: number };

/**
 * Predicates that describe the SOURCE (a letter, an invoice) rather than the
 * entity. They're useful as metadata on the Source row but pollute the entity's
 * Context.md if treated as entity facts — every document would land 5+ duplicate
 * "letter.issuer = Huber & Partner" rows on the WEG.
 */
const SOURCE_META_PREDICATES = new Set([
  "letter.kind",
  "letter.issuer",
  "letter.datum",
  "letter.ort",
  "recipient.anrede",
  "recipient.name",
  "recipient.address",
  "payment.iban",
  "payment.bic",
  "payment.bank",
  "legal.steuernr",
  "legal.ust_id",
  "invoice.vendor",
  "invoice.kundennr",
]);

function importPdfs(data: Stammdaten): void {
  const pdfTextsPath = path.join(HACKATHON_DIR, "pdf_texts.json");
  if (!fs.existsSync(pdfTextsPath)) {
    console.log(`[hausbuch] no pdf_texts.json — run scripts/extract-pdf-texts.mjs to populate`);
    return;
  }

  let entries: PdfText[];
  try {
    entries = JSON.parse(fs.readFileSync(pdfTextsPath, "utf8")) as PdfText[];
  } catch (err) {
    console.warn(`[hausbuch] pdf_texts.json malformed: ${String(err)}`);
    return;
  }

  // Lookup tables for routing. We build separate maps so we can prefer a
  // tenant match over an owner match (e.g. a Mahnung addressed to a renter).
  const tenantByName = new Map<string, string>();
  const ownerByName = new Map<string, string>();
  const contractorByFirma = new Map<string, string>();
  // Tenant → unit, owner → first owned unit, for context-md routing.
  const tenantUnit = new Map<string, string>();
  const ownerFirstUnit = new Map<string, string>();
  for (const o of data.eigentuemer) {
    ownerByName.set(`${o.vorname} ${o.nachname}`.toLowerCase(), `owner:${o.id}`);
    if (o.einheit_ids?.[0]) ownerFirstUnit.set(`owner:${o.id}`, `unit:${o.einheit_ids[0]}`);
  }
  for (const m of data.mieter) {
    tenantByName.set(`${m.vorname} ${m.nachname}`.toLowerCase(), `tenant:${m.id}`);
    tenantUnit.set(`tenant:${m.id}`, `unit:${m.einheit_id}`);
  }
  for (const d of data.dienstleister) {
    // Match either the full firma string or just its first significant token
    // ("SecureLock Systems Ltd." → "securelock").
    const norm = d.firma.toLowerCase();
    contractorByFirma.set(norm, `contractor:${d.id}`);
    const firstWord = norm.split(/\s+/)[0];
    if (firstWord && firstWord.length > 3) {
      contractorByFirma.set(firstWord, `contractor:${d.id}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ext = require("./extractor") as {
    extractSync: (entity: string, source: Source) => Array<{
      predicate: string;
      value: string | number | boolean | null;
      unit?: string;
      valid_from?: string | null;
      span: { start: number; end: number; quote: string };
      confidence: number;
    }>;
  };

  let totalSources = 0;
  let totalFacts = 0;
  let skippedMeta = 0;
  const routingHistogram = new Map<string, number>();

  for (const entry of entries) {
    const filename = entry.file.split("/").pop() ?? entry.file;
    const now = new Date().toISOString();
    const sourceId = newSourceId(filename);
    const isInvoice = /rechnungen|invoice/i.test(entry.file);
    const isEtv = /etv_/i.test(filename);

    // First pass: extract WITHOUT routing so we can read recipient.name + invoice.vendor.
    const sourceProbe: Source = {
      id: sourceId,
      kind: isInvoice ? "invoice" : "letter",
      title: filename.replace(/\.pdf$/i, ""),
      ingested_at: now,
      raw_excerpt: entry.text.slice(0, 8192),
      source_prior: 0.9,
    };
    const facts = ext.extractSync(ENTITY, sourceProbe);

    // Decide routing.
    let entity = ENTITY;
    let routedHow = "weg-fallback";

    if (isEtv) {
      // ETV invitations / protocols are about the WEG itself.
      entity = ENTITY;
      routedHow = "etv→weg";
    } else if (isInvoice) {
      // Vendor invoice — match the first line (vendor) against contractors.
      const vendor = facts.find((f) => f.predicate === "invoice.vendor")?.value;
      if (typeof vendor === "string") {
        const v = vendor.toLowerCase();
        for (const [name, id] of contractorByFirma) {
          if (v.includes(name)) { entity = id; routedHow = "invoice→contractor"; break; }
        }
      }
    } else {
      // Hausverwaltung letter — recipient name lookup.
      const recipient = facts.find((f) => f.predicate === "recipient.name")?.value;
      if (typeof recipient === "string") {
        const r = recipient.toLowerCase();
        // Tenant first (most letters target renters); owner second.
        const tid = tenantByName.get(r);
        const oid = !tid ? ownerByName.get(r) : null;
        if (tid) { entity = tid; routedHow = "letter→tenant"; }
        else if (oid) { entity = oid; routedHow = "letter→owner"; }
      }
    }

    // Now create the actual source row with the routed entity.
    const source: Source = { ...sourceProbe, entity_id: entity };
    insertSource(source);
    totalSources++;
    routingHistogram.set(routedHow, (routingHistogram.get(routedHow) ?? 0) + 1);

    // Insert facts, skipping source-metadata predicates so the entity's
    // Context.md isn't drowned in repeating "letter.issuer = Huber & Partner".
    // Domain facts (mahnung.*, hausgeld.*, nebenkosten.*, etv.*, mieterhoehung.*,
    // kuendigung.*, invoice.*) are kept because they describe the entity's state.
    for (const f of facts) {
      if (SOURCE_META_PREDICATES.has(f.predicate)) {
        skippedMeta++;
        continue;
      }
      writeFact(
        entity,
        f.predicate,
        f.value,
        sourceId,
        f.span.quote,
        now,
        f.unit,
        f.valid_from ?? undefined,
      );
      totalFacts++;
    }
  }

  // Suppress unused-variable warnings for routing helpers reserved for future
  // smarter routing (per-unit BKA → unit, per-owner Hausgeld → unit).
  void tenantUnit;
  void ownerFirstUnit;

  const histogram = [...routingHistogram.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");
  console.log(
    `[hausbuch] imported ${totalSources} PDFs · ${totalFacts} entity-facts ` +
      `(${skippedMeta} source-meta facts kept on the source row only) · routing: ${histogram}`,
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeStammdatenSource(id: string, title: string, now: string): Source {
  return {
    id,
    kind: "stammdaten",
    title,
    ingested_at: now,
    raw_excerpt: title,
    source_prior: 0.95,
  };
}

function writeFact(
  entity: string,
  predicate: string,
  value: string | number | boolean | null,
  sourceId: string,
  quote: string,
  knownFrom: string,
  unit?: string,
  validFrom?: string,
): void {
  const factId = newFactId();
  const fact: Fact = {
    id: factId,
    entity,
    predicate,
    value,
    unit,
    valid_from: validFrom ?? null,
    valid_to: null,
    known_from: knownFrom,
    known_to: null,
    source: sourceId,
    span: { start: 0, end: quote.length, quote },
    confidence: 0.9,
    superseded_by: null,
    ident: ident(entity, predicate, validFrom ?? null),
  };
  insertFact(fact);
  logEvent("insert", factId, `seed · ${predicate}`);
}

// ── Minimal seed (fallback when hackathon data isn't available) ─────────────

function seedMinimal(): void {
  const now = new Date().toISOString();
  insertEntity({
    id: ENTITY, type: "weg", name: "WEG Immanuelkirchstraße 26",
    meta: { plz: "10405", ort: "Berlin" },
    created_at: now,
  });
  const src = makeStammdatenSource("stammdaten:minimal", "Minimal seed", now);
  insertSource(src);
  writeFact(ENTITY, "identity.name", "WEG Immanuelkirchstraße 26", src.id, "WEG Immanuelkirchstraße 26", now);
  writeFact(ENTITY, "identity.address", "Immanuelkirchstraße 26, 10405 Berlin", src.id, "Immanuelkirchstraße 26, 10405 Berlin", now);
}

// ── Demo scenarios (kept for backwards compat) ──────────────────────────────

export type ScenarioSource = {
  id: string; label: string; date: string; icon: string; blurb: string;
  kind: SourceKind; title: string; raw_excerpt: string; source_prior: number;
};

// Three-stage demo scenarios — all from the same tenant (Magrit Mitschke, WE 32)
// so the agents' answers about her unit measurably evolve as facts arrive.
// Each excerpt includes the unit anchor (WE 32) and the tenant surname so the
// relevance gate accepts it and the extractor can attach to tenant:MIE-016.
export const DEMO_SCENARIOS: ScenarioSource[] = [
  {
    id: "mold-report",
    label: "Schimmel-Meldung",
    date: "2026-01-03",
    icon: "⚠",
    blurb: "Magrit Mitschke (WE 32) reports mold + water damage, threatens 15% rent reduction",
    kind: "email",
    title: "Mietminderung Ankuendigung — Magrit Mitschke",
    raw_excerpt:
      "Sehr geehrte Verwaltung, da die Baumaengel (Wasserschaden, Schimmel) in meiner Wohnung WE 32 seit ueber 3 Monaten nicht behoben sind, werde ich die Miete ab 02.02.2026 um 15% mindern. Eine rechtliche Grundlage liegt aus meiner Sicht vor. Magrit Mitschke",
    source_prior: 0.7,
  },
  {
    id: "heating-failure",
    label: "Heizung defekt",
    date: "2026-01-09",
    icon: "🔥",
    blurb: "Magrit Mitschke (WE 32) follow-up: heating now also failed — situation worsening",
    kind: "email",
    title: "Heizung defekt — Magrit Mitschke (WE 32)",
    raw_excerpt:
      "Sehr geehrte Verwaltung, zusaetzlich zu der bekannten Schimmel- und Wasserschaden-Problematik in meiner Wohnung WE 32 ist seit gestern Abend auch die Heizung komplett ausgefallen. Bei -3°C Aussentemperatur ist das nicht zumutbar. Bitte umgehende Beauftragung eines Heizungsmonteurs. Magrit Mitschke",
    source_prior: 0.75,
  },
  {
    id: "lawyer-letter",
    label: "Anwaltschreiben",
    date: "2026-01-15",
    icon: "⚖",
    blurb: "Magrit Mitschke (WE 32) escalates via attorney — 14-day deadline before court action",
    kind: "letter",
    title: "Anwaltliches Aufforderungsschreiben — WE 32 Mitschke",
    raw_excerpt:
      "Sehr geehrte Damen und Herren, in der Angelegenheit unserer Mandantin Frau Magrit Mitschke, Mieterin der Wohnung WE 32, fordern wir Sie hiermit auf, die seit Oktober 2025 angezeigten Maengel (Wasserschaden, Schimmel, Heizungsausfall) binnen 14 Tagen zu beseitigen. Andernfalls werden wir gerichtliche Schritte einleiten. Mit freundlichen Gruessen, Kanzlei Berger & Partner.",
    source_prior: 0.92,
  },
];
