// path: src/app/api/upload-bulk/route.ts
/**
 * Bulk upload — accepts a zip archive, walks supported files, and ingests
 * them through the standard pipeline. Returns a summary plus a list of
 * *conflicts* (cases where the new data disagreed with what we already had)
 * so the UI can offer revoke / edit per item.
 *
 * Supported formats:
 *   .eml / .txt / .md / .note  →  email or note body
 *   .pdf                       →  letter / scanned document
 *   .csv / .json               →  master data (stammdaten import path)
 *   .jpg / .png / .webp        →  image (Gemini vision OCR)
 */

import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { db, getEntity } from "@/lib/db";
import { ingest } from "@/lib/ingest";
import { extractSync } from "@/lib/extractor";
import { invalidateRecommendationsCache } from "@/lib/recommendations";
import { buildRouter, routeForDoc } from "@/lib/route-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 200;
const MAX_BYTES_PER_FILE = 1_500_000;

const SUPPORTED_FORMATS = {
  email_text: [".eml", ".txt", ".md", ".note"],
  letter: [".pdf"],
  master_data: [".csv", ".json", ".jsonl"],
  image: [".jpg", ".jpeg", ".png", ".webp"],
};
const TEXT_EXT = new Set(SUPPORTED_FORMATS.email_text);
const ALL_EXT = new Set(Object.values(SUPPORTED_FORMATS).flat());

function kindFor(filename: string): "email" | "letter" | "note" {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  if (ext === ".eml") return "email";
  if (ext === ".pdf") return "letter";
  return "note";
}

function extractFromAddr(text: string): string | undefined {
  const m = text.match(/^from:\s*([^\r\n]+)/im);
  if (!m) return undefined;
  const inner = m[1].match(/<([^>]+)>/);
  return (inner ? inner[1] : m[1]).trim().toLowerCase();
}

function extractSubject(text: string): string | undefined {
  const m = text.match(/^subject:\s*([^\r\n]+)/im);
  return m ? m[1].trim() : undefined;
}

function stripEmailHeaders(text: string): string {
  const idx = text.indexOf("\r\n\r\n");
  if (idx >= 0) return text.slice(idx + 4).trim();
  const idx2 = text.indexOf("\n\n");
  if (idx2 >= 0) return text.slice(idx2 + 2).trim();
  return text.trim();
}

export async function POST(req: NextRequest) {
  db();
  const t0 = performance.now();

  // preview=1 → extract + route + return facts WITHOUT writing. The dashboard's
  // review modal calls this for zips and posts confirmed facts to /api/upload/commit.
  const previewOnly = req.nextUrl.searchParams.get("preview") === "1";
  const form = await req.formData();
  const file = form.get("file");
  const targetEntity =
    (form.get("entity") as string | null) || "weg:immanuelkirchstr-26";

  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: "missing 'file' field", supported_formats: SUPPORTED_FORMATS },
      { status: 400 },
    );
  }

  let zip: AdmZip;
  try {
    const buf = Buffer.from(await (file as Blob).arrayBuffer());
    zip = new AdmZip(buf);
  } catch (err) {
    return NextResponse.json(
      {
        error: `not a valid zip: ${err instanceof Error ? err.message : String(err)}`,
        supported_formats: SUPPORTED_FORMATS,
      },
      { status: 400 },
    );
  }

  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const byKind: Record<string, number> = {};
  let processed = 0;
  let skipped = 0;
  let factsAdded = 0;
  const entityCounts = new Map<string, number>();
  const sampleSubjects: string[] = [];
  // Per-file results in the same shape /api/upload returns, so the
  // UploadInspector can render zip uploads identically to single-file uploads.
  const uploaded: Array<{
    name: string;
    size: number;
    kind: string;
    facts: number;
    conflicts: number;
    latency_ms: number;
    extract_preview: string;
    source_id?: string;
    fact_details?: Array<{ entity: string; predicate: string; value: string; quote: string }>;
    error?: string;
  }> = [];

  // Build the routing lookup once for the whole zip — same logic as /api/upload.
  const router = buildRouter();
  type ConflictRow = {
    fact_id: string;
    entity: string;
    entity_name: string;
    predicate: string;
    new_value: string;
    competing: Array<{ value: string; probability: number }>;
    source_title: string;
  };
  const conflicts: ConflictRow[] = [];
  const errors: string[] = [];
  const origin = req.nextUrl.origin;

  for (const entry of entries) {
    if (processed >= MAX_FILES) break;
    const name = entry.entryName;
    if (name.includes(".DS_Store") || name.endsWith("/")) {
      skipped++;
      continue;
    }
    const ext = name.toLowerCase().slice(name.lastIndexOf("."));
    if (!ALL_EXT.has(ext)) {
      skipped++;
      continue;
    }
    if (entry.header.size > MAX_BYTES_PER_FILE) {
      skipped++;
      continue;
    }

    // Tally by kind for the result summary
    const kindKey =
      (Object.entries(SUPPORTED_FORMATS).find(([, exts]) => exts.includes(ext)) ?? [
        "other",
      ])[0];
    byKind[kindKey] = (byKind[kindKey] ?? 0) + 1;

    // PDFs go through pdf-parse + the same heuristic extractor used by
    // /api/upload, then route per-file (recipient match for letters,
    // vendor match for invoices). Images are still skipped here — vision
    // OCR happens in /api/upload only.
    if (ext === ".pdf") {
      try {
        const buf = entry.getData();
        const t0pdf = performance.now();
        const pdfText = await extractPdfText(buf);
        if (!pdfText || pdfText.trim().length < 12) {
          skipped++;
          continue;
        }
        const entityForPdf = routeForDoc(router, name, pdfText).entity;
        const sourceKind = /invoice|rechnung/i.test(name) ? "invoice" : "letter";
        const sourceTitle = name.split("/").pop() ?? name;

        if (previewOnly) {
          const probe = extractSync(entityForPdf, {
            id: "preview",
            kind: sourceKind,
            title: sourceTitle,
            ingested_at: new Date().toISOString(),
            raw_excerpt: pdfText.slice(0, 8192),
            source_prior: 0.85,
          });
          processed++;
          uploaded.push({
            name: sourceTitle,
            size: buf.byteLength,
            kind: sourceKind,
            facts: probe.length,
            conflicts: 0,
            latency_ms: Math.round(performance.now() - t0pdf),
            extract_preview: pdfText.slice(0, 8192),
            fact_details: probe.map((f) => ({
              entity: entityForPdf,
              predicate: f.predicate,
              value: String(f.value ?? ""),
              quote: f.span?.quote ?? "",
            })),
          });
          continue;
        }

        const result = await ingest({
          entity: entityForPdf,
          source: {
            kind: sourceKind,
            title: sourceTitle,
            raw_excerpt: pdfText.slice(0, 8192),
            source_prior: 0.85,
          },
        });
        processed++;
        factsAdded += result.inserted;
        for (const f of result.facts) {
          entityCounts.set(f.entity, (entityCounts.get(f.entity) ?? 0) + 1);
        }
        uploaded.push({
          name: name.split("/").pop() ?? name,
          size: buf.byteLength,
          kind: /invoice|rechnung/i.test(name) ? "invoice" : "letter",
          facts: result.facts.length,
          conflicts: result.conflicts.length,
          latency_ms: Math.round(performance.now() - t0pdf),
          extract_preview: pdfText.slice(0, 200),
          source_id: result.source.id,
          fact_details: result.facts.slice(0, 30).map((f) => ({
            entity: f.entity,
            predicate: f.predicate,
            value: String(f.value ?? ""),
            quote: f.span?.quote?.slice(0, 200) ?? "",
          })),
        });
        continue;
      } catch (err) {
        errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        skipped++;
        continue;
      }
    }

    // Images / other binaries — count and skip (no vision OCR in bulk path).
    if (!TEXT_EXT.has(ext)) {
      skipped++;
      continue;
    }

    let text: string;
    try {
      text = entry.getData().toString("utf8");
    } catch {
      skipped++;
      continue;
    }

    const isEml = ext === ".eml";
    const subject = isEml ? extractSubject(text) : name.split("/").pop() ?? name;
    const fromAddr = isEml ? extractFromAddr(text) : undefined;
    const body = isEml ? stripEmailHeaders(text) : text;

    if (!body || body.length < 12) {
      skipped++;
      continue;
    }

    try {
      const result = await ingest({
        entity: targetEntity,
        source: {
          kind: kindFor(name),
          title: (subject ?? name).slice(0, 200),
          raw_excerpt: body.slice(0, 4000),
          source_prior: isEml ? 0.7 : 0.6,
          from_addr: fromAddr,
        },
        origin,
      });

      processed++;
      factsAdded += result.inserted;

      for (const f of result.facts) {
        entityCounts.set(f.entity, (entityCounts.get(f.entity) ?? 0) + 1);
      }
      if (result.identity?.entity_id) {
        entityCounts.set(
          result.identity.entity_id,
          (entityCounts.get(result.identity.entity_id) ?? 0) + 1,
        );
      }

      uploaded.push({
        name: name.split("/").pop() ?? name,
        size: body.length,
        kind: kindFor(name),
        facts: result.facts.length,
        conflicts: result.conflicts.length,
        latency_ms: result.latency_ms,
        extract_preview: body.slice(0, 200),
        source_id: result.source.id,
        fact_details: result.facts.slice(0, 30).map((f) => ({
          entity: f.entity,
          predicate: f.predicate,
          value: String(f.value ?? ""),
          quote: f.span?.quote?.slice(0, 200) ?? "",
        })),
      });

      // Surface conflicts so the user can revoke or edit them.
      for (const c of result.conflicts) {
        // Find the fact_id we just wrote for this predicate
        const newFact = result.facts.find((f) => f.predicate === c.predicate);
        if (!newFact) continue;
        const ent = getEntity(newFact.entity);
        conflicts.push({
          fact_id: newFact.id,
          entity: newFact.entity,
          entity_name: ent?.name ?? newFact.entity,
          predicate: c.predicate,
          new_value: String(newFact.value),
          competing: c.posterior.map((p) => ({
            value: p.value,
            probability: p.probability,
          })),
          source_title: result.source.title,
        });
      }

      if (subject && sampleSubjects.length < 5) sampleSubjects.push(subject);
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (factsAdded > 0) invalidateRecommendationsCache();

  const entitiesChanged = Array.from(entityCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id, count]) => {
      const e = getEntity(id);
      return {
        id,
        name: e?.name ?? id,
        type: e?.type ?? id.split(":")[0] ?? "unknown",
        fact_count: count,
      };
    });

  const latency_ms = Math.round(performance.now() - t0);

  return NextResponse.json({
    files_total: entries.length,
    files_processed: processed,
    files_skipped: skipped,
    facts_added: factsAdded,
    conflicts_found: conflicts.length,
    conflicts,
    entities_changed: entitiesChanged,
    by_kind: byKind,
    sample_subjects: sampleSubjects,
    errors: errors.slice(0, 5),
    latency_ms,
    supported_formats: SUPPORTED_FORMATS,
    // Per-file array — same shape as /api/upload returns. Lets UploadInspector
    // render zip uploads with the same FileResultCard breakdown.
    uploaded,
  });
}

// ── PDF extraction (mirrors /api/upload's helper) ───────────────────────────

async function extractPdfText(buf: Buffer): Promise<string> {
  type PDFParseCtor = new (opts: { data: Uint8Array | Buffer }) => {
    getText: () => Promise<{ text: string }>;
    destroy?: () => Promise<void> | void;
  };
  const mod = (await import("pdf-parse")) as unknown as {
    PDFParse: PDFParseCtor;
    default?: { PDFParse?: PDFParseCtor };
  };
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
  if (!PDFParse) throw new Error("pdf-parse: PDFParse class not found");
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    try { await parser.destroy?.(); } catch { /* ignore */ }
  }
}

