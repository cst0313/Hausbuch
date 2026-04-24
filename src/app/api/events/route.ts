// path: src/app/api/events/route.ts
import { NextResponse } from "next/server";
import { db, listEvents } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  db();
  const events = listEvents(50);
  return NextResponse.json({ events });
}
