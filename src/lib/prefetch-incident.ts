// path: src/lib/prefetch-incident.ts
/**
 * Browser-side prefetch for the incident detail flow.
 *
 * When the manager hovers a recommendation row, fire the network requests
 * the StreamPanel will need before the click lands:
 *
 *   • GET /api/source/<id>    — full email body for each chain message
 *   • POST /api/draft          — pre-composed reply (Gemini, ~600ms)
 *
 * The draft response gets stored in the same sessionStorage key the
 * StreamPanel already reads from, so the panel's read-through path picks
 * up the prefetched result without any other coordination. Source GETs
 * are absorbed by the browser's HTTP cache (the route serves a static
 * row, so a Cache-Control header isn't required for hit-on-second-fetch
 * within the same tab).
 *
 * No coupling: the prefetcher is fire-and-forget. If the user never
 * clicks, the only cost is the network bytes we already asked for.
 */

type DraftContext = {
  from?: string;
  to?: string;
  to_email?: string;
  subject?: string;
  incident_summary?: string;
  entity_context?: string;
  language?: string;
  tone?: string;
};

type EmailChain = Array<{ source_id: string; title: string; date?: string }>;

type RecForPrefetch = {
  id: string;
  email_chain?: EmailChain;
  actions?: Array<{
    type: string;
    draft_context?: DraftContext;
  }>;
};

// Per-page-load dedup so hovering the same row 5x doesn't fan out 5×
// network calls. The cache key is the rec id; per-rec content can change
// between sessions but not within one.
const inflight = new Set<string>();

function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function prefetchIncident(rec: RecForPrefetch): void {
  if (typeof window === "undefined") return;
  if (inflight.has(rec.id)) return;
  inflight.add(rec.id);

  // 1. Source GETs — fire all in parallel, browser cache handles dedup
  //    on subsequent fetches by URL.
  const chain = rec.email_chain ?? [];
  for (const msg of chain.slice(0, 5)) {
    void fetch(`/api/source/${encodeURIComponent(msg.source_id)}`, {
      method: "GET",
      // priority: "low" tells the browser this is best-effort
      // — the actual click can preempt with a normal fetch.
      // (TS lib hasn't caught up to the spec yet.)
      ...({ priority: "low" } as object),
    }).catch(() => {
      /* swallow — prefetch is best-effort */
    });
  }

  // 2. Pre-compose the reply draft. Hits Gemini (~600ms), but the result
  //    lands in sessionStorage at exactly the key StreamPanel reads from,
  //    so when the user clicks the row the panel paints instantly.
  const draftAction = rec.actions?.find((a) => a.type === "draft_email" && a.draft_context);
  const ctx = draftAction?.draft_context;
  if (ctx) {
    const cacheKey = `hausbuch:draft:${hashKey(JSON.stringify(ctx))}`;
    try {
      if (sessionStorage.getItem(cacheKey)) return; // already cached, nothing to do
    } catch {
      // sessionStorage disabled — still safe to issue the fetch, the panel
      // just won't find a cache entry on click.
    }
    void fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ctx),
    })
      .then((r) => r.json())
      .then((d) => {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(d));
        } catch {
          /* quota / disabled */
        }
      })
      .catch(() => {});
  }
}
