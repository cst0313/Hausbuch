// path: src/lib/graph.ts
// path: src/lib/graph.ts
import { db } from "./db";
import type { Fact } from "./types";

/**
 * Qontext track asks for a virtual file system + graph over the context base.
 *
 * We derive the graph from the fact store rather than maintaining a separate
 * relationships table. The predicates that introduce new entities are
 * enumerated in ENTITY_PREDICATES; each matching fact creates a typed edge
 * from the host entity to a derived entity.
 *
 * This keeps the derivation explainable (no hidden ML) and reversible: if a
 * source fact is superseded, the edge disappears on next graph read without
 * any extra cleanup.
 */

export type Edge = {
  from: string;        // entity:property:berliner-str-42
  to: string;          // entity:tenant:anna-schmidt
  relation: string;    // "has_tenant"
  source: string;      // fact source title
  since?: string | null;
  until?: string | null;
  confidence: number;
};

export type Node = {
  id: string;           // "property:berliner-str-42" | "tenant:anna-schmidt"
  kind: string;         // "property" | "tenant" | "organization" | ...
  label: string;        // human-readable name
  facts: number;        // how many facts reference this node
  sources: string[];    // source titles backing the node
};

/** Predicates that introduce new entities connected to the host. */
const ENTITY_PREDICATES: Array<{
  predicate: string;
  makeId: (value: string) => string;
  relation: string;
  kind: string;
}> = [
  {
    predicate: "identity.owner",
    makeId: (v) => `organization:${slug(v)}`,
    relation: "owned_by",
    kind: "organization",
  },
  {
    predicate: "tenancy.tenant",
    makeId: (v) => `person:${slug(v)}`,
    relation: "has_tenant",
    kind: "person",
  },
  {
    predicate: "contact.manager",
    makeId: (v) => `organization:${slug(v)}`,
    relation: "managed_by",
    kind: "organization",
  },
  {
    predicate: "contact.primary",
    makeId: (v) => `person:${slug(v)}`,
    relation: "contact",
    kind: "person",
  },
];

export function buildGraph(focus?: string): { nodes: Node[]; edges: Edge[] } {
  db();
  const rows = db()
    .prepare(
      `SELECT id, entity, predicate, value, source, known_from, known_to, valid_from, valid_to, confidence, span_quote
       FROM facts
       WHERE known_to IS NULL
       ${focus ? "AND entity = @focus" : ""}
       ORDER BY known_from ASC`,
    )
    .all(focus ? { focus } : {}) as Array<{
    id: string;
    entity: string;
    predicate: string;
    value: string;
    source: string;
    known_from: string;
    known_to: string | null;
    valid_from: string | null;
    valid_to: string | null;
    confidence: number;
  }>;

  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];

  const addNode = (id: string, kind: string, label: string, sourceTitle: string) => {
    const existing = nodes.get(id);
    if (existing) {
      existing.facts += 1;
      if (!existing.sources.includes(sourceTitle)) existing.sources.push(sourceTitle);
    } else {
      nodes.set(id, { id, kind, label, facts: 1, sources: [sourceTitle] });
    }
  };

  // Fetch source titles cheaply
  const sources = new Map<string, string>();
  const sourceRows = db().prepare("SELECT id, title FROM sources").all() as Array<{ id: string; title: string }>;
  for (const s of sourceRows) sources.set(s.id, s.title);

  for (const r of rows) {
    const srcTitle = sources.get(r.source) ?? r.source;

    // Always register the host entity as a node
    addNode(r.entity, entityKind(r.entity), humanize(r.entity), srcTitle);

    // If this predicate introduces a linked entity, create it
    const ep = ENTITY_PREDICATES.find((e) => e.predicate === r.predicate);
    if (ep) {
      const toId = ep.makeId(r.value);
      addNode(toId, ep.kind, r.value, srcTitle);
      edges.push({
        from: r.entity,
        to: toId,
        relation: ep.relation,
        source: srcTitle,
        since: r.valid_from ?? r.known_from,
        until: r.valid_to ?? null,
        confidence: r.confidence,
      });
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}

/**
 * Virtual File System — a tree view of the context base grouped by entity kind.
 *
 * /
 * ├── property/
 * │   └── berliner-str-42/
 * │       ├── Context.md
 * │       ├── facts.json       (all facts as structured records)
 * │       └── sources/
 * │           ├── lease-2024-03.pdf
 * │           └── …
 * ├── person/
 * │   └── anna-schmidt/
 * │       └── tenant-of.md    (back-references)
 * └── organization/
 *     └── mueller-immobilien-gmbh/
 */
export function buildVFS(): VFSNode {
  const { nodes } = buildGraph();
  const root: VFSNode = { name: "/", kind: "dir", children: [] };

  const byKind = new Map<string, Node[]>();
  for (const n of nodes) {
    const [kind] = n.id.split(":");
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind)!.push(n);
  }

  for (const [kind, ns] of Array.from(byKind.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const kindDir: VFSNode = { name: kind, kind: "dir", children: [] };
    for (const n of ns.sort((a, b) => a.label.localeCompare(b.label))) {
      const entityId = n.id.split(":").slice(1).join(":");
      const entityDir: VFSNode = {
        name: entityId,
        kind: "dir",
        children: [
          { name: "Context.md", kind: "file", size_hint: `${n.facts} facts`, ref: `/api/context/${encodeURIComponent(n.id)}` },
          { name: "facts.json", kind: "file", size_hint: "raw facts", ref: `/api/context/${encodeURIComponent(n.id)}?format=json` },
        ],
      };
      if (n.sources.length > 0) {
        entityDir.children!.push({
          name: "sources/",
          kind: "dir",
          children: n.sources.map((src) => ({ name: src, kind: "file", size_hint: "source" })),
        });
      }
      kindDir.children!.push(entityDir);
    }
    root.children!.push(kindDir);
  }

  return root;
}

export type VFSNode = {
  name: string;
  kind: "dir" | "file";
  size_hint?: string;
  ref?: string;
  children?: VFSNode[];
};

/* ─────────────────────────────────────────────────────────────────────────
 * helpers
 * ──────────────────────────────────────────────────────────────────────── */

function slug(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function entityKind(entityId: string): string {
  return entityId.split(":")[0] ?? "unknown";
}

function humanize(entityId: string): string {
  if (entityId === "property:berliner-str-42") return "Berliner Str. 42";
  const tail = entityId.split(":").slice(1).join(":");
  return tail.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
