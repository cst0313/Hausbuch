// path: src/components/CodeSample.tsx
"use client";

import { useState } from "react";

const pythonSnippet = `from hausbuch import Context

# Load the living context for an entity
ctx = Context.load("property:berliner-str-42")

# Read at any point in bitemporal space
print(ctx.render(detail=3))            # current truth, now
print(ctx.at("2024-03-01"))            # historical: what was true in Mar 2024
print(ctx.as_of(known="2026-04-15"))   # what we knew on Apr 15

# Pass straight to Claude — cacheable prefix, citations guaranteed
from anthropic import Anthropic
response = Anthropic().messages.create(
    model="claude-sonnet-4-6",
    system=ctx.render(detail=3),
    messages=[{"role": "user", "content": "What's next month's rent?"}],
    extra_headers={"anthropic-cache-control": "ephemeral"},
)
# → "€1,650 (posterior 0.90). Landlord proposed €1,800 but
#    Mietpreisbremse caps at €1,650. legal-memo-2026.pdf §4."`;

const tsSnippet = `import { Context } from "@hausbuch/client";
import type { BerlinerStr42 } from "./Context.d";

// Typed access — the .d.ts is auto-emitted alongside Context.md
const ctx = await Context.load<BerlinerStr42>("property:berliner-str-42");

// Bitemporal queries
const now      = await ctx.render({ detail: 3 });
const history  = await ctx.at({ valid: "2024-03-01" });
const capsule  = await ctx.at({ valid: "2024-03", known: "2024-04-01" });

// Subscribe to changes
ctx.on("conflict", ({ predicate, posterior }) => {
  console.log(\`⚠ \${predicate}:\`, posterior);
});`;

const curlSnippet = `# ask the context engine directly — no agent framework needed
curl https://hausbuch.local/api/query \\
  -H "content-type: application/json" \\
  -d '{
    "entity": "property:berliner-str-42",
    "question": "What did we know about next month's rent on 2026-04-15?",
    "detail": 3,
    "at": "2026-04-15"
  }'
# 200 OK
# {
#   "answer": "€1,500 — the landlord email had not yet been ingested.",
#   "citations": ["lease-2024-03.pdf p.3"],
#   "cache_hit": true,
#   "tokens_in": 1847, "tokens_out": 82, "latency_ms": 1183
# }`;

const tabs = [
  { id: "py", label: "python", code: pythonSnippet },
  { id: "ts", label: "typescript", code: tsSnippet },
  { id: "curl", label: "curl", code: curlSnippet },
];

export function CodeSample() {
  const [active, setActive] = useState("py");
  const current = tabs.find((t) => t.id === active)!;

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: "1px solid var(--line)" }}
      >
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className="px-3 py-1.5 text-[11px] font-mono rounded transition-colors"
              style={{
                background:
                  active === t.id ? "rgba(232, 178, 107, 0.08)" : "transparent",
                color:
                  active === t.id ? "var(--amber-bright)" : "var(--ink-muted)",
                border: `1px solid ${active === t.id ? "rgba(232, 178, 107, 0.3)" : "transparent"}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          className="text-[10px] font-mono"
          style={{ color: "var(--ink-dim)" }}
        >
          v0.1 · apache-2.0
        </div>
      </div>
      <pre
        className="p-5 font-mono text-[12px] leading-relaxed overflow-x-auto"
        style={{ color: "var(--ink)" }}
      >
        <code>{current.code}</code>
      </pre>
    </div>
  );
}
