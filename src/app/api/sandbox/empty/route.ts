// path: src/app/api/sandbox/empty/route.ts
/**
 * Truly empties the database (unlike /api/reset which re-seeds the hackathon
 * corpus). Used by the /sandbox page so a judge can start with a blank
 * Context engine and watch it learn from documents they upload themselves.
 *
 * The schema is preserved — we just truncate the data tables. A small marker
 * row in entities prevents seedIfEmpty() from re-seeding on the next db()
 * call, since that function gates on entities.count > 0.
 */
import { NextResponse } from "next/server";
import { closeDb, db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  closeDb();
  const handle = db();
  const tx = handle.transaction(() => {
    handle.exec(`
      DELETE FROM fact_events;
      DELETE FROM facts;
      DELETE FROM sources;
      DELETE FROM proposals;
      DELETE FROM enrichment_cache;
      DELETE FROM actions;
      DELETE FROM entities;
      INSERT INTO entities (id, type, name, parent_id, meta_json, created_at)
        VALUES ('sandbox:marker', 'weg', '— sandbox · empty engine —', NULL, NULL,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
    `);
  });
  tx();
  return NextResponse.json({ ok: true });
}
