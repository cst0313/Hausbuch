// path: src/app/api/reset/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { closeDb, db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dev-only: close the in-memory SQLite handle, delete the file, re-seed.
 * Useful during the live demo to reset between rehearsals.
 */
export async function POST() {
  closeDb();
  const DB_PATH = path.resolve(process.cwd(), "data", "lumen.db");
  for (const p of [DB_PATH, DB_PATH + "-wal", DB_PATH + "-shm"]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // ignore; next db() will recreate
    }
  }
  // Warm the connection so the next request sees seed data
  db();
  return NextResponse.json({ reset: true });
}
