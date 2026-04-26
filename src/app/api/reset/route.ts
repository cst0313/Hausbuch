// path: src/app/api/reset/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { closeDb, db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reset to the seeded hackathon dataset. Two paths:
 *   1. Try to delete the SQLite file and let db() reseed from disk.
 *   2. If the file is locked (Windows can't unlink an open file even after
 *      close), TRUNCATE every table in place and call seedIfEmpty() directly.
 * Either way, the next request sees a freshly seeded database.
 */
export async function POST() {
  closeDb();
  const DB_PATH = path.resolve(process.cwd(), "data", "hausbuch.db");
  let deleted = false;
  for (const p of [DB_PATH, DB_PATH + "-wal", DB_PATH + "-shm"]) {
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        deleted = true;
      }
    } catch {
      // file locked — fall through to in-place truncate
    }
  }

  const handle = db();
  if (!deleted) {
    // File survived; nuke every row in place and re-seed the new connection.
    handle.transaction(() => {
      handle.exec(`
        DELETE FROM fact_events;
        DELETE FROM facts;
        DELETE FROM sources;
        DELETE FROM proposals;
        DELETE FROM enrichment_cache;
        DELETE FROM actions;
        DELETE FROM entities;
      `);
    })();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const seed = require("@/lib/seed") as { seedIfEmpty: (db: unknown) => void };
    seed.seedIfEmpty(handle);
  }

  return NextResponse.json({ reset: true, mode: deleted ? "file" : "truncate" });
}
