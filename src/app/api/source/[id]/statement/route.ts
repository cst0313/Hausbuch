// path: src/app/api/source/[id]/statement/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db, getSource } from "@/lib/db";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATEMENT_CSV = path.resolve(
  process.cwd(),
  "tmp",
  "hackathon",
  "bank",
  "kontoauszug_2024_2025.csv",
);

type StmtRow = {
  date: string;
  buchungstext: string;
  verwendungszweck: string;
  kundenreferenz: string;
  beguenstigter: string;
  iban: string;
  bic: string;
  betrag: string;
  saldo: string;
};

let cached: { rows: StmtRow[]; byTx: Map<string, number> } | null = null;

function loadStatement(): { rows: StmtRow[]; byTx: Map<string, number> } | null {
  if (cached) return cached;
  if (!fs.existsSync(STATEMENT_CSV)) return null;
  // Sparkasse-style export: semicolon delimiter, German number formatting,
  // Saldo embedded as "Saldo: 46256,00" inside the Info column.
  const lines = fs.readFileSync(STATEMENT_CSV, "utf8").split(/\r?\n/);
  if (lines.length < 2) return null;
  const headers = lines[0].split(";");
  const idx = (name: string) => headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const iBuchungstag = idx("Buchungstag");
  const iBuchungstext = idx("Buchungstext");
  const iVerwendung = idx("Verwendungszweck");
  const iKundenref = idx("Kundenreferenz (End-to-End)");
  const iBeguenstigter = idx("Beguenstigter/Zahlungspflichtiger");
  const iIban = idx("Kontonummer/IBAN");
  const iBic = idx("BIC (SWIFT-Code)");
  const iBetrag = idx("Betrag");
  const iInfo = idx("Info");

  const rows: StmtRow[] = [];
  const byTx = new Map<string, number>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";");
    if (cols.length < 5) continue;
    const txRef = (cols[iKundenref] ?? "").trim();
    const info = (cols[iInfo] ?? "").trim();
    const saldoMatch = info.match(/Saldo:\s*([\d.,]+)/);
    rows.push({
      date: (cols[iBuchungstag] ?? "").trim(),
      buchungstext: (cols[iBuchungstext] ?? "").trim(),
      verwendungszweck: (cols[iVerwendung] ?? "").trim(),
      kundenreferenz: txRef,
      beguenstigter: (cols[iBeguenstigter] ?? "").trim(),
      iban: (cols[iIban] ?? "").trim(),
      bic: (cols[iBic] ?? "").trim(),
      betrag: (cols[iBetrag] ?? "").trim(),
      saldo: saldoMatch ? saldoMatch[1] : "",
    });
    if (txRef) byTx.set(txRef, rows.length - 1);
  }
  cached = { rows, byTx };
  return cached;
}

/**
 * GET /api/source/<id>/statement
 *
 * For a per-transaction bank source (id = src:bank:TX-NNNNN), locate the
 * matching row in the live Sparkasse-format kontoauszug CSV and return
 * the row plus ±5 surrounding rows so the provenance drawer can render
 * "this transaction in context of the actual statement document".
 *
 * If the source isn't a bank transaction with a TX reference, returns 400.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  db();
  const { id } = await ctx.params;
  const source = getSource(decodeURIComponent(id));
  if (!source) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (source.kind !== "bank") {
    return NextResponse.json({ error: "source is not a bank transaction" }, { status: 400 });
  }
  // The seeded source IDs are of the form "src:bank:TX-NNNNN".
  const txMatch = source.id.match(/TX-\d+/);
  if (!txMatch) {
    return NextResponse.json({ error: "no TX reference on this source" }, { status: 400 });
  }
  const tx = txMatch[0];
  const stmt = loadStatement();
  if (!stmt) return NextResponse.json({ error: "statement CSV missing" }, { status: 404 });

  const rowIdx = stmt.byTx.get(tx);
  if (rowIdx === undefined) {
    return NextResponse.json({ error: `tx ${tx} not in statement` }, { status: 404 });
  }
  const WINDOW = 5;
  const start = Math.max(0, rowIdx - WINDOW);
  const end = Math.min(stmt.rows.length, rowIdx + WINDOW + 1);
  return NextResponse.json({
    tx,
    statement: {
      file: "kontoauszug_2024_2025.csv",
      total_rows: stmt.rows.length,
      window: { start, end, focus: rowIdx },
    },
    rows: stmt.rows.slice(start, end).map((r, i) => ({
      ...r,
      lineno: start + i + 1, // 1-indexed for human display
      isFocus: start + i === rowIdx,
    })),
  });
}
