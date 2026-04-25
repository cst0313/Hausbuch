// path: src/lib/patcher.ts
/**
 * Surgical update layer for Context.md.
 *
 * The renderer emits anchored fact blocks:
 *
 *   <!-- fact:<ident> -->
 *   rent.base         €1,500 / month  ^[lease-2024-03.pdf]
 *   <!-- /fact:<ident> -->
 *
 * These anchors are invisible to agents reading the Markdown (they're HTML
 * comments) but let the patcher replace ONLY the lines for a changed fact
 * without touching anything else in the document — including text the user
 * has written between anchors.
 *
 * Contract with the renderer:
 *  - Every fact line is preceded by <!-- fact:IDENT --> on its own line
 *  - Every fact line is followed by <!-- /fact:IDENT --> on its own line
 *  - A conflict block is similarly wrapped with <!-- conflict:predicate --> … <!-- /conflict:predicate -->
 *  - Section headings and human-authored prose are NEVER wrapped; the patcher
 *    will leave them alone during updates.
 *
 * Why this matters (Buena track, challenge §2):
 *   "when a new email arrives you can't generate a whole new file.
 *    Regenerating the file destroys human edits and burns tokens.
 *    You must patch exactly the right section."
 */

export type PatchOp =
  | { kind: "upsert-fact"; ident: string; block: string[] }
  | { kind: "remove-fact"; ident: string }
  | { kind: "upsert-conflict"; predicate: string; block: string[] }
  | { kind: "remove-conflict"; predicate: string }
  | { kind: "replace-trailer"; content: string };

export type PatchResult = {
  next: string;
  applied: number;
  skipped: Array<{ op: PatchOp; reason: string }>;
  preserved_user_lines: number;
};

/**
 * Apply a list of surgical operations to an existing Context.md string.
 * Returns the new content plus a summary of what happened.
 */
export function patch(current: string, ops: PatchOp[]): PatchResult {
  let doc = current;
  let applied = 0;
  const skipped: PatchResult["skipped"] = [];
  const preservedUserLines = countUserLines(current);

  for (const op of ops) {
    switch (op.kind) {
      case "upsert-fact": {
        const { next, ok } = upsertBlock(doc, factAnchors(op.ident), op.block);
        if (ok) {
          doc = next;
          applied++;
        } else {
          skipped.push({ op, reason: "no section found and no default-insert location" });
        }
        break;
      }
      case "remove-fact": {
        const { next, ok } = removeBlock(doc, factAnchors(op.ident));
        if (ok) {
          doc = next;
          applied++;
        } else {
          skipped.push({ op, reason: "anchors not found; nothing to remove" });
        }
        break;
      }
      case "upsert-conflict": {
        const { next, ok } = upsertBlock(doc, conflictAnchors(op.predicate), op.block);
        if (ok) {
          doc = next;
          applied++;
        } else {
          skipped.push({ op, reason: "conflict section missing; append-trailing" });
        }
        break;
      }
      case "remove-conflict": {
        const { next, ok } = removeBlock(doc, conflictAnchors(op.predicate));
        if (ok) {
          doc = next;
          applied++;
        } else {
          skipped.push({ op, reason: "anchors not found; nothing to remove" });
        }
        break;
      }
      case "replace-trailer": {
        doc = replaceTrailer(doc, op.content);
        applied++;
        break;
      }
    }
  }

  return { next: doc, applied, skipped, preserved_user_lines: preservedUserLines };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Anchors
 * ──────────────────────────────────────────────────────────────────────── */

export function factAnchors(ident: string): [string, string] {
  return [`<!-- fact:${ident} -->`, `<!-- /fact:${ident} -->`];
}

export function conflictAnchors(predicate: string): [string, string] {
  // Escape dot-segments so predicates like "tenancy.rent.next" are safe in the HTML comment
  const key = predicate.replace(/[^a-z0-9._-]/gi, "_");
  return [`<!-- conflict:${key} -->`, `<!-- /conflict:${key} -->`];
}

/* ─────────────────────────────────────────────────────────────────────────
 * Block replace / remove / insert
 * ──────────────────────────────────────────────────────────────────────── */

function upsertBlock(
  doc: string,
  [open, close]: [string, string],
  block: string[],
): { next: string; ok: boolean } {
  const openIdx = doc.indexOf(open);
  const closeIdx = doc.indexOf(close);
  if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
    const before = doc.slice(0, openIdx);
    const after = doc.slice(closeIdx + close.length);
    const replacement = [open, ...block, close].join("\n");
    return { next: before + replacement + after, ok: true };
  }
  // Not found — insert before the trailer
  const trailerIdx = doc.search(/<!-- Hausbuch · /);
  const payload = [open, ...block, close, ""].join("\n");
  if (trailerIdx !== -1) {
    return {
      next: doc.slice(0, trailerIdx) + payload + doc.slice(trailerIdx),
      ok: true,
    };
  }
  // No trailer either — append at end
  return { next: doc + "\n" + payload, ok: true };
}

function removeBlock(
  doc: string,
  [open, close]: [string, string],
): { next: string; ok: boolean } {
  const openIdx = doc.indexOf(open);
  const closeIdx = doc.indexOf(close);
  if (openIdx === -1 || closeIdx === -1 || closeIdx <= openIdx) {
    return { next: doc, ok: false };
  }
  // Also consume the newline immediately following the close-tag, if any
  const end = closeIdx + close.length + (doc[closeIdx + close.length] === "\n" ? 1 : 0);
  return { next: doc.slice(0, openIdx) + doc.slice(end), ok: true };
}

function replaceTrailer(doc: string, content: string): string {
  const re = /<!-- Hausbuch · [^\n]*-->/;
  if (re.test(doc)) return doc.replace(re, content);
  return doc.trimEnd() + "\n" + content + "\n";
}

/* ─────────────────────────────────────────────────────────────────────────
 * Human-edit preservation — count lines outside any fact/conflict block
 * ──────────────────────────────────────────────────────────────────────── */

function countUserLines(doc: string): number {
  let inBlock = false;
  let user = 0;
  for (const line of doc.split("\n")) {
    if (/<!--\s*(fact|conflict):/.test(line)) {
      inBlock = true;
      continue;
    }
    if (/<!--\s*\/(fact|conflict):/.test(line)) {
      inBlock = false;
      continue;
    }
    // Also skip Hausbuch's own header / trailer
    if (line.startsWith("# Context.md") || line.startsWith("> auto-generated") || line.startsWith("> bitemporal")) continue;
    if (line.startsWith("<!-- Hausbuch ·")) continue;
    if (line.startsWith("## ")) continue;
    if (line.trim() === "") continue;
    if (!inBlock) user++;
  }
  return user;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Pretty extractor for debugging — parse a Context.md back into its facts
 * ──────────────────────────────────────────────────────────────────────── */

export function listAnchoredFacts(doc: string): string[] {
  const idents: string[] = [];
  const re = /<!--\s*fact:([^\s-]+?)\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    idents.push(m[1]);
  }
  return idents;
}
