// path: src/app/api/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingest } from "@/lib/ingest";
import type { SourceKind } from "@/lib/types";
import { extractFromImage, GeminiError } from "@/lib/llm/gemini";
import { buildRouter, routeForDoc } from "@/lib/route-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/upload — accepts one or more files via multipart/form-data.
 *
 * Dispatches to the right extractor per file extension:
 *   .txt, .md       → read as UTF-8
 *   .eml            → strip RFC 822 headers, keep the body
 *   .pdf            → pdf-parse; if it returns no usable text (scanned PDF),
 *                     fall through to Gemini vision and label kind=image-ocr
 *   .jpg/.jpeg/.png/.webp → Gemini vision (FR-24), kind=image-ocr
 *   others          → try UTF-8 decode as last resort
 *
 * Each file becomes a Source; the ingest pipeline extracts facts + reconciles.
 */

/** PDFs shorter than this after pdf-parse are assumed to be scanned and re-routed to vision. */
const SCANNED_PDF_THRESHOLD = 40;

export async function POST(req: NextRequest) {
  db();
  // entity from query string is an explicit override; otherwise we route per-file
  // based on the document's recipient name / vendor identity.
  const entityOverride = req.nextUrl.searchParams.get("entity");
  // preview=1 → extract + route + return facts WITHOUT writing to the DB.
  // The dashboard's review modal uses this so the user can edit/skip facts
  // before the corresponding /api/upload/commit call persists them.
  const previewOnly = req.nextUrl.searchParams.get("preview") === "1";
  const router = entityOverride ? null : buildRouter();
  const form = await req.formData();
  const files = form.getAll("files") as File[];
  if (files.length === 0) {
    return NextResponse.json({ error: "no files provided (field name 'files')" }, { status: 400 });
  }

  const results: Array<{
    name: string;
    size: number;
    kind: SourceKind;
    facts: number;
    conflicts: number;
    latency_ms: number;
    extract_preview: string;
    extractor?: string;
    error?: string;
    /** Detailed facts learned from this file (for the inspector UI). */
    fact_details?: Array<{
      entity: string;
      predicate: string;
      value: string;
      quote: string;
    }>;
    /** Source id created for this file. */
    source_id?: string;
  }> = [];

  for (const file of files) {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const mime = (file.type || "").toLowerCase();
      const { text, kind, extractor } = await extractText(file.name, mime, buf);

      // Route per file: if no override, run a probe extraction on the text and
      // pick the entity matching recipient.name (letters) or invoice.vendor
      // (rechnungen). Auto-creates the entity when no match exists, so an
      // empty engine self-bootstraps from documents alone.
      const entity = entityOverride ?? routeForDoc(router!, file.name, text).entity;
      const sourceTitle =
        kind === "image-ocr"
          ? `${file.name} (extracted by Gemini vision)`
          : file.name;
      const sourcePrior = inferPrior(kind, file.name);

      if (previewOnly) {
        // Run extraction without committing — same code path as ingest, just
        // skipping the writes. The dashboard's review modal renders this and
        // posts the (possibly edited) facts back via /api/upload/commit.
        const probe = await import("@/lib/extractor").then((m) =>
          m.extractSync(entity, {
            id: "preview",
            kind,
            title: sourceTitle,
            ingested_at: new Date().toISOString(),
            raw_excerpt: text.slice(0, 8192),
            source_prior: sourcePrior,
          }),
        );
        results.push({
          name: file.name,
          size: buf.byteLength,
          kind,
          facts: probe.length,
          conflicts: 0,
          latency_ms: 0,
          extract_preview: text.slice(0, 8192),
          extractor,
          fact_details: probe.map((f) => ({
            entity,
            predicate: f.predicate,
            value: String(f.value ?? ""),
            quote: f.span?.quote ?? "",
          })),
        });
        continue;
      }

      const result = await ingest({
        entity,
        source: {
          kind,
          title: sourceTitle,
          raw_excerpt: text.slice(0, 8192),
          source_prior: sourcePrior,
        },
      });
      results.push({
        name: file.name,
        size: buf.byteLength,
        kind,
        facts: result.facts.length,
        conflicts: result.conflicts.length,
        latency_ms: result.latency_ms,
        extract_preview: text.slice(0, 200),
        extractor,
        source_id: result.source.id,
        fact_details: result.facts.slice(0, 30).map((f) => ({
          entity: f.entity,
          predicate: f.predicate,
          value: String(f.value ?? ""),
          quote: f.span?.quote?.slice(0, 200) ?? "",
        })),
      });
    } catch (err) {
      results.push({
        name: file.name,
        size: 0,
        kind: "note",
        facts: 0,
        conflicts: 0,
        latency_ms: 0,
        extract_preview: "",
        error: String(err instanceof Error ? err.message : err),
      });
    }
  }

  return NextResponse.json({ uploaded: results });
}

type ExtractResult = { text: string; kind: SourceKind; extractor: string };

async function extractText(filename: string, mime: string, buf: Buffer): Promise<ExtractResult> {
  const lower = filename.toLowerCase();

  // Image inputs go straight to Gemini vision.
  const isImageMime =
    mime === "image/jpeg" ||
    mime === "image/jpg" ||
    mime === "image/png" ||
    mime === "image/webp";
  const isImageExt = /\.(jpe?g|png|webp)$/i.test(lower);
  if (isImageMime || isImageExt) {
    const text = await visionExtract(buf, normalizeImageMime(mime, lower));
    return { text, kind: "image-ocr", extractor: "gemini-vision" };
  }

  if (lower.endsWith(".pdf")) {
    let pdfText = "";
    try {
      pdfText = await extractPdfText(buf);
    } catch {
      pdfText = "";
    }
    // If pdf-parse came back empty / near-empty, treat the PDF as scanned and
    // hand it to Gemini vision. Vision on PDFs works on flash; we feed the
    // PDF bytes through the inlineData path with mime=application/pdf.
    if (pdfText.trim().length < SCANNED_PDF_THRESHOLD) {
      try {
        const text = await visionExtract(buf, "application/pdf");
        return { text, kind: "image-ocr", extractor: "gemini-vision" };
      } catch (err) {
        // Vision failed too — surface what pdf-parse gave us, even if empty.
        // Better to record an empty source than to lose the upload entirely.
        if (err instanceof GeminiError && err.kind === "missing-key") {
          // Honest label: vision unavailable, falling back to whatever pdf-parse produced.
          return { text: pdfText, kind: "pdf", extractor: "pdf-parse-fallback" };
        }
        return { text: pdfText, kind: "pdf", extractor: "pdf-parse-fallback" };
      }
    }
    return { text: pdfText, kind: "pdf", extractor: "pdf-parse" };
  }
  if (lower.endsWith(".eml")) {
    const body = parseEml(buf.toString("utf8"));
    return { text: body, kind: "email", extractor: "eml" };
  }
  if (lower.endsWith(".md")) {
    return { text: buf.toString("utf8"), kind: "note", extractor: "utf8" };
  }
  if (lower.endsWith(".txt")) {
    return { text: buf.toString("utf8"), kind: "note", extractor: "utf8" };
  }
  if (lower.endsWith(".json") || lower.endsWith(".jsonl")) {
    return { text: buf.toString("utf8"), kind: "erp", extractor: "utf8" };
  }
  // Last-resort: try UTF-8
  return { text: buf.toString("utf8"), kind: "note", extractor: "utf8" };
}

async function visionExtract(buf: Buffer, mime: string): Promise<string> {
  const out = await extractFromImage({ bytes: buf, mime });
  return out.text;
}

function normalizeImageMime(mime: string, filename: string): string {
  if (mime && mime.startsWith("image/")) {
    if (mime === "image/jpg") return "image/jpeg";
    return mime;
  }
  if (/\.(jpe?g)$/i.test(filename)) return "image/jpeg";
  if (/\.png$/i.test(filename)) return "image/png";
  if (/\.webp$/i.test(filename)) return "image/webp";
  return "image/jpeg";
}

async function extractPdfText(buf: Buffer): Promise<string> {
  // pdf-parse v2.x: class-based API. Construct a PDFParse with the buffer and
  // call getText(). Cast through unknown because the package types are ESM-only
  // and the shape varies between CJS/ESM bundling paths.
  type PDFParseCtor = new (opts: { data: Uint8Array | Buffer }) => {
    getText: () => Promise<{ text: string }>;
    destroy?: () => Promise<void> | void;
  };
  const mod = (await import("pdf-parse")) as unknown as {
    PDFParse: PDFParseCtor;
    default?: { PDFParse?: PDFParseCtor };
  };
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse;
  if (!PDFParse) {
    throw new Error("pdf-parse: PDFParse class not found in module exports");
  }
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    try {
      await parser.destroy?.();
    } catch {
      // destroy is best-effort
    }
  }
}

function parseEml(raw: string): string {
  // Strip everything up to the first blank line (headers) and concatenate remaining text.
  const idx = raw.indexOf("\n\n") >= 0 ? raw.indexOf("\n\n") : raw.indexOf("\r\n\r\n");
  const headers = idx >= 0 ? raw.slice(0, idx) : "";
  const body = idx >= 0 ? raw.slice(idx + (raw[idx + 1] === "\n" ? 2 : 4)) : raw;
  const fromMatch = headers.match(/^From:\s*(.+)$/im);
  const subjMatch = headers.match(/^Subject:\s*(.+)$/im);
  const dateMatch = headers.match(/^Date:\s*(.+)$/im);
  const prelude = [
    fromMatch ? `From: ${fromMatch[1].trim()}` : null,
    subjMatch ? `Betreff: ${subjMatch[1].trim()}` : null,
    dateMatch ? `Date: ${dateMatch[1].trim()}` : null,
  ]
    .filter(Boolean)
    .join(". ");
  return (prelude ? prelude + ". " : "") + body.trim();
}

function inferPrior(kind: SourceKind, name: string): number {
  // Rough heuristic: courts/statutes > operator records > emails > casual notes.
  // image-ocr lands a notch below pdf because the OCR layer adds error.
  if (kind === "legal") return 0.94;
  if (/legal|memo|law|court|statute/i.test(name)) return 0.9;
  if (kind === "pdf") return 0.9;
  if (kind === "erp") return 0.9;
  if (kind === "zendesk") return 0.85;
  if (kind === "image-ocr") return 0.82;
  if (kind === "slack") return 0.8;
  if (kind === "email") return 0.65;
  if (kind === "note") return 0.6;
  return 0.75;
}
