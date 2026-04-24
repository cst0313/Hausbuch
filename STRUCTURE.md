# Directory structure of the Lumen codebase

This bundle flattens paths using `__` as a separator, so file collisions (`page.tsx`, `route.ts`) are avoided.

Below is the **real** tree. Each leaf shows the real filename and the flat name in this bundle.

```
lumen/
├── samples/
│   ├── email-landlord-2027-rent-update.md  →  samples__email-landlord-2027-rent-update.md
│   ├── email-renewal-offer-apt2.md  →  samples__email-renewal-offer-apt2.md
│   ├── email-tenant-apt6-maintenance.md  →  samples__email-tenant-apt6-maintenance.md
│   ├── erp-building-b4412-2026.csv  →  samples__erp-building-b4412-2026.csv
│   ├── erp-rentroll-b4412-2026-11.csv  →  samples__erp-rentroll-b4412-2026-11.csv
│   ├── inspection-report-2026-q4.md  →  samples__inspection-report-2026-q4.md
│   ├── kuendigung-apt3-hartmann.md  →  samples__kuendigung-apt3-hartmann.md
│   ├── lease-apt4-2026.md  →  samples__lease-apt4-2026.md
│   ├── lease-apt5-2026.md  →  samples__lease-apt5-2026.md
│   ├── legal-memo-2027-mietpreisbremse.md  →  samples__legal-memo-2027-mietpreisbremse.md
│   ├── notes-quarterly-review-2026-q4.md  →  samples__notes-quarterly-review-2026-q4.md
│   ├── slack-maint-2026-q4.json  →  samples__slack-maint-2026-q4.json
│   └── zendesk-tickets-2026-q4.json  →  samples__zendesk-tickets-2026-q4.json
├── scripts/
│   ├── test-normalize.ts  →  scripts__test-normalize.ts
│   └── test-patcher.ts  →  scripts__test-patcher.ts
├── snapshots/
│   ├── bitemporal/
│   │   ├── context-at-known-2024-01-01.md  →  snapshots__bitemporal__context-at-known-2024-01-01.md
│   │   ├── context-at-known-2024-04-01.md  →  snapshots__bitemporal__context-at-known-2024-04-01.md
│   │   ├── context-at-known-2025-06-01.md  →  snapshots__bitemporal__context-at-known-2025-06-01.md
│   │   ├── context-at-known-2026-01-01.md  →  snapshots__bitemporal__context-at-known-2026-01-01.md
│   │   ├── context-at-known-2026-04-17.md  →  snapshots__bitemporal__context-at-known-2026-04-17.md
│   │   ├── context-at-known-2026-04-19.md  →  snapshots__bitemporal__context-at-known-2026-04-19.md
│   │   ├── context-at-known-2026-04-22.md  →  snapshots__bitemporal__context-at-known-2026-04-22.md
│   │   ├── context-at-known-2026-06-01.md  →  snapshots__bitemporal__context-at-known-2026-06-01.md
│   │   └── context-at-known-2027-01-01.md  →  snapshots__bitemporal__context-at-known-2027-01-01.md
│   ├── sample-extractions/
│   │   ├── email-landlord-2027-rent-update.extraction.json  →  snapshots__sample-extractions__email-landlord-2027-rent-update.extraction.json
│   │   ├── email-renewal-offer-apt2.extraction.json  →  snapshots__sample-extractions__email-renewal-offer-apt2.extraction.json
│   │   ├── email-tenant-apt6-maintenance.extraction.json  →  snapshots__sample-extractions__email-tenant-apt6-maintenance.extraction.json
│   │   ├── erp-building-b4412-2026.extraction.json  →  snapshots__sample-extractions__erp-building-b4412-2026.extraction.json
│   │   ├── erp-rentroll-b4412-2026-11.extraction.json  →  snapshots__sample-extractions__erp-rentroll-b4412-2026-11.extraction.json
│   │   ├── inspection-report-2026-q4.extraction.json  →  snapshots__sample-extractions__inspection-report-2026-q4.extraction.json
│   │   ├── kuendigung-apt3-hartmann.extraction.json  →  snapshots__sample-extractions__kuendigung-apt3-hartmann.extraction.json
│   │   ├── lease-apt4-2026.extraction.json  →  snapshots__sample-extractions__lease-apt4-2026.extraction.json
│   │   ├── lease-apt5-2026.extraction.json  →  snapshots__sample-extractions__lease-apt5-2026.extraction.json
│   │   ├── legal-memo-2027-mietpreisbremse.extraction.json  →  snapshots__sample-extractions__legal-memo-2027-mietpreisbremse.extraction.json
│   │   ├── notes-quarterly-review-2026-q4.extraction.json  →  snapshots__sample-extractions__notes-quarterly-review-2026-q4.extraction.json
│   │   ├── slack-maint-2026-q4.extraction.json  →  snapshots__sample-extractions__slack-maint-2026-q4.extraction.json
│   │   └── zendesk-tickets-2026-q4.extraction.json  →  snapshots__sample-extractions__zendesk-tickets-2026-q4.extraction.json
│   ├── AUDIT.md  →  snapshots__AUDIT.md
│   ├── CODE_TOUR.md  →  snapshots__CODE_TOUR.md
│   ├── ablation-matrix.json  →  snapshots__ablation-matrix.json
│   ├── api-patched-context.json  →  snapshots__api-patched-context.json
│   ├── api-query-chatbot.json  →  snapshots__api-query-chatbot.json
│   ├── api-query-drafter.json  →  snapshots__api-query-drafter.json
│   ├── context-after-scenarios.md  →  snapshots__context-after-scenarios.md
│   ├── context-at-known-2026-04-19.md  →  snapshots__context-at-known-2026-04-19.md
│   ├── context-baseline.md  →  snapshots__context-baseline.md
│   ├── context-detail-5-with-archive.md  →  snapshots__context-detail-5-with-archive.md
│   ├── context-full-json.json  →  snapshots__context-full-json.json
│   ├── dependencies.json  →  snapshots__dependencies.json
│   ├── git-full-with-diffs.log  →  snapshots__git-full-with-diffs.log
│   ├── git-history.log  →  snapshots__git-history.log
│   ├── graph-full.json  →  snapshots__graph-full.json
│   ├── test-normalize.log  →  snapshots__test-normalize.log
│   ├── test-patcher.log  →  snapshots__test-patcher.log
│   └── vfs.json  →  snapshots__vfs.json
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── benchmark/
│   │   │   │   └── route.ts  →  src__app__api__benchmark__route.ts
│   │   │   ├── context/
│   │   │   │   └── [entity]/
│   │   │   │       └── route.ts  →  src__app__api__context__[entity]__route.ts
│   │   │   ├── events/
│   │   │   │   └── route.ts  →  src__app__api__events__route.ts
│   │   │   ├── graph/
│   │   │   │   └── route.ts  →  src__app__api__graph__route.ts
│   │   │   ├── ingest/
│   │   │   │   └── route.ts  →  src__app__api__ingest__route.ts
│   │   │   ├── patched-context/
│   │   │   │   └── route.ts  →  src__app__api__patched-context__route.ts
│   │   │   ├── query/
│   │   │   │   └── route.ts  →  src__app__api__query__route.ts
│   │   │   ├── reset/
│   │   │   │   └── route.ts  →  src__app__api__reset__route.ts
│   │   │   ├── scenarios/
│   │   │   │   └── route.ts  →  src__app__api__scenarios__route.ts
│   │   │   ├── stream/
│   │   │   │   └── route.ts  →  src__app__api__stream__route.ts
│   │   │   └── upload/
│   │   │       └── route.ts  →  src__app__api__upload__route.ts
│   │   ├── demo/
│   │   │   └── page.tsx  →  src__app__demo__page.tsx
│   │   ├── graph/
│   │   │   └── page.tsx  →  src__app__graph__page.tsx
│   │   ├── protocol/
│   │   │   └── page.tsx  →  src__app__protocol__page.tsx
│   │   ├── research/
│   │   │   └── page.tsx  →  src__app__research__page.tsx
│   │   ├── technical/
│   │   │   └── page.tsx  →  src__app__technical__page.tsx
│   │   ├── globals.css  →  src__app__globals.css
│   │   ├── layout.tsx  →  src__app__layout.tsx
│   │   ├── not-found.tsx  →  src__app__not-found.tsx
│   │   └── page.tsx  →  src__app__page.tsx
│   ├── components/
│   │   ├── AblationMatrix.tsx  →  src__components__AblationMatrix.tsx
│   │   ├── ActivityLog.tsx  →  src__components__ActivityLog.tsx
│   │   ├── ArchitectureDiagram.tsx  →  src__components__ArchitectureDiagram.tsx
│   │   ├── BenchmarkTable.tsx  →  src__components__BenchmarkTable.tsx
│   │   ├── CodeSample.tsx  →  src__components__CodeSample.tsx
│   │   ├── ComparisonTable.tsx  →  src__components__ComparisonTable.tsx
│   │   ├── ContextPreview.tsx  →  src__components__ContextPreview.tsx
│   │   ├── DemoConsole.tsx  →  src__components__DemoConsole.tsx
│   │   ├── FactExplainPopover.tsx  →  src__components__FactExplainPopover.tsx
│   │   ├── FileDropZone.tsx  →  src__components__FileDropZone.tsx
│   │   ├── GraphView.tsx  →  src__components__GraphView.tsx
│   │   ├── InteractiveFacts.tsx  →  src__components__InteractiveFacts.tsx
│   │   ├── KeyboardShortcuts.tsx  →  src__components__KeyboardShortcuts.tsx
│   │   ├── LiveCostTicker.tsx  →  src__components__LiveCostTicker.tsx
│   │   ├── LumenMark.tsx  →  src__components__LumenMark.tsx
│   │   ├── Nav.tsx  →  src__components__Nav.tsx
│   │   ├── SourceConstellation.tsx  →  src__components__SourceConstellation.tsx
│   │   ├── StatCounter.tsx  →  src__components__StatCounter.tsx
│   │   └── VFSView.tsx  →  src__components__VFSView.tsx
│   └── lib/
│       ├── ablations.ts  →  src__lib__ablations.ts
│       ├── claude-baselines.ts  →  src__lib__claude-baselines.ts
│       ├── compose.ts  →  src__lib__compose.ts
│       ├── db.ts  →  src__lib__db.ts
│       ├── events.ts  →  src__lib__events.ts
│       ├── extractor.ts  →  src__lib__extractor.ts
│       ├── graph.ts  →  src__lib__graph.ts
│       ├── ingest.ts  →  src__lib__ingest.ts
│       ├── normalize.ts  →  src__lib__normalize.ts
│       ├── patcher.ts  →  src__lib__patcher.ts
│       ├── query.ts  →  src__lib__query.ts
│       ├── reconciler.ts  →  src__lib__reconciler.ts
│       ├── relevance.ts  →  src__lib__relevance.ts
│       ├── renderer.ts  →  src__lib__renderer.ts
│       ├── seed.ts  →  src__lib__seed.ts
│       └── types.ts  →  src__lib__types.ts
├── AGENTS.md  →  AGENTS.md
├── CHANGELOG.log  →  CHANGELOG.log
├── CLAUDE.md  →  CLAUDE.md
├── DIFFERENTIATION.md  →  DIFFERENTIATION.md
├── LOCAL_EDITS.log  →  LOCAL_EDITS.log
├── PAPER.md  →  PAPER.md
├── PROTOCOL.md  →  PROTOCOL.md
├── README.md  →  README.md
├── REBUILD.md  →  REBUILD.md
├── hackathon_description.md  →  hackathon_description.md
├── next.config.ts  →  next.config.ts
├── package-lock.json  →  package-lock.json
├── package.json  →  package.json
└── tsconfig.json  →  tsconfig.json
```

## Reconstruction (one-liner)

```bash
# assuming all files extracted into the current directory:
jq -r '.files[] | "\(.flat_name)\t\(.real_path)"' MANIFEST.json | \
  while IFS=$'\t' read -r flat real; do
    mkdir -p "lumen-restored/$(dirname "$real")"
    mv "$flat" "lumen-restored/$real"
  done
```

## In-file path header (redundant signal)

Every `.ts`/`.tsx`/`.css`/`.md` file in this bundle starts with a comment declaring its path — so an agent can reconstruct the tree from the file contents alone if the filenames also get mangled:

```
// path: src/app/api/benchmark/route.ts      (first line of .ts/.tsx)
/* path: src/app/globals.css */              (first line of .css)
<!-- path: samples/lease-apt4-2026.md -->    (first line of .md)
```
