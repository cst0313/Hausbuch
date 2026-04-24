// path: src/app/api/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingest } from "@/lib/ingest";
import type { SourceKind } from "@/lib/types";
import { ENTITY } from "@/lib/seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/upload — accepts one or more files via multipart/form-data.
 *
 * Dispatches to the right extractor per file extension:
 *   .txt, .md       → read as UTF-8
 *   .eml            → strip RFC 822 headers, keep the body
 *   .pdf            → pdf-parse
 *   others          → try UTF-8 decode as last resort
 *
 * Each file becomes a Source; the ingest pipeline extracts facts + reconciles.
 */
export async function POST(req: NextRequest) {
  db();
  const entity = (req.nextUrl.searchParams.get("entity") ?? ENTITY) as string;
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
    error?: string;
  }> = [];

  for (const file of files) {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const { text, kind } = await extractText(file.name, buf);
      const result = await ingest({
        entity,
        source: {
          kind,
          title: file.name,
          raw_excerpt: text.slice(0, 8192), // cap for demo
          source_prior: inferPrior(kind, file.name),
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

  return NextResponse.json({ entity, uploaded: results });
}

async function extractText(
  filename: string,
  buf: Buffer,
): Promise<{ text: string; kind: SourceKind }> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const text = await extractPdfText(buf);
    return { text, kind: "pdf" };
  }
  if (lower.endsWith(".eml")) {
    const body = parseEml(buf.toString("utf8"));
    return { text: body, kind: "email" };
  }
  if (lower.endsWith(".md")) {
    return { text: buf.toString("utf8"), kind: "note" };
  }
  if (lower.endsWith(".txt")) {
    return { text: buf.toString("utf8"), kind: "note" };
  }
  if (lower.endsWith(".json") || lower.endsWith(".jsonl")) {
    return { text: buf.toString("utf8"), kind: "erp" };
  }
  // Last-resort: try UTF-8
  return { text: buf.toString("utf8"), kind: "note" };
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
  // Rough heuristic: courts/statutes > operator records > emails > casual notes
  if (kind === "legal") return 0.94;
  if (/legal|memo|law|court|statute/i.test(name)) return 0.9;
  if (kind === "pdf") return 0.9;
  if (kind === "erp") return 0.9;
  if (kind === "zendesk") return 0.85;
  if (kind === "slack") return 0.8;
  if (kind === "email") return 0.65;
  if (kind === "note") return 0.6;
  return 0.75;
}
