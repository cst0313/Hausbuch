// path: src/app/api/source/[id]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, getSource } from "@/lib/db";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HACKATHON_DIR = path.resolve(process.cwd(), "tmp", "hackathon");
const SEARCH_ROOTS = [
  path.join(HACKATHON_DIR, "briefe"),
  path.join(HACKATHON_DIR, "rechnungen"),
  path.join(HACKATHON_DIR, "incremental"),
];

/**
 * GET /api/source/<id>/pdf
 *
 * Streams the original PDF bytes for a letter / invoice source so the
 * provenance drawer can render the actual page with highlights instead
 * of plain Markdown text.
 *
 * Resolution: the source.title is the original filename (without .pdf).
 * We search the three hackathon roots recursively for <title>.pdf and
 * cache the path-by-title map for the process lifetime.
 */
const pathByTitle = new Map<string, string>();
let mapBuilt = false;

function buildMap(): void {
  if (mapBuilt) return;
  for (const root of SEARCH_ROOTS) {
    if (!fs.existsSync(root)) continue;
    walk(root, (file) => {
      if (file.toLowerCase().endsWith(".pdf")) {
        const base = path.basename(file).replace(/\.pdf$/i, "");
        // First match wins; duplicates across roots are unlikely.
        if (!pathByTitle.has(base)) pathByTitle.set(base, file);
      }
    });
  }
  mapBuilt = true;
}

function walk(dir: string, cb: (file: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cb);
    else if (entry.isFile()) cb(full);
  }
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  db();
  const { id } = await ctx.params;
  const source = getSource(decodeURIComponent(id));
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!["letter", "invoice", "pdf"].includes(source.kind)) {
    return NextResponse.json({ error: "source is not a PDF" }, { status: 400 });
  }
  buildMap();
  const filePath = pathByTitle.get(source.title);
  if (!filePath || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: "PDF file not found on disk" }, { status: 404 });
  }
  const bytes = fs.readFileSync(filePath);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${source.title}.pdf"`,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
