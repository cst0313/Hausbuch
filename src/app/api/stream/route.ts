// path: src/app/api/stream/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { subscribe } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-sent events stream of Hausbuch internal events. Browsers connect via
 * EventSource and render animations in response.
 */
export async function GET(_req: NextRequest) {
  db();
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };
      send(JSON.stringify({ kind: "hello", at: new Date().toISOString() }));
      const unsubscribe = subscribe((e) => send(JSON.stringify(e)));
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 15000);
      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      _req.signal?.addEventListener?.("abort", close);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
