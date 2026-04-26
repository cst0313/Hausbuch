// path: src/components/NoteComposer.tsx
"use client";

import { useEffect, useState } from "react";

type EntityRow = {
  id: string;
  type: string;
  name: string;
};

type IngestResult = {
  ingested?: number;
  inserted?: number;
  conflicts?: unknown[];
  source_id?: string;
  error?: string;
};

const COMMON_TYPES = new Set(["weg", "building", "unit", "owner", "tenant", "contractor"]);

export function NoteComposer({
  defaultEntity = "weg:immanuelkirchstr-26",
  onIngested,
}: {
  defaultEntity?: string;
  onIngested?: (result: IngestResult) => void;
}) {
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [entity, setEntity] = useState(defaultEntity);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/entities")
      .then((r) => r.json())
      .then((d: { entities: EntityRow[] }) => {
        const filtered = d.entities.filter((e) => COMMON_TYPES.has(e.type));
        setEntities(filtered);
      })
      .catch(() => setEntities([]));
  }, []);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setResult(null);
    try {
      const titleStub = trimmed.slice(0, 60).replace(/\s+/g, " ");
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          source: {
            kind: "note",
            title: `Note · ${titleStub}${trimmed.length > 60 ? "…" : ""}`,
            raw_excerpt: trimmed,
            source_prior: 0.6,
          },
        }),
      });
      const data = (await res.json()) as IngestResult;
      setResult(data);
      onIngested?.(data);
      if (!data.error) setText("");
    } catch (err) {
      setResult({ error: String(err) });
    } finally {
      setBusy(false);
    }
  };

  // Group entities by type for the dropdown
  const grouped = new Map<string, EntityRow[]>();
  for (const e of entities) {
    const list = grouped.get(e.type) ?? [];
    list.push(e);
    grouped.set(e.type, list);
  }
  const TYPE_ORDER = ["weg", "building", "unit", "owner", "tenant", "contractor"] as const;
  const TYPE_LABELS: Record<string, string> = {
    weg: "WEG",
    building: "Buildings",
    unit: "Units",
    owner: "Owners",
    tenant: "Tenants",
    contractor: "Contractors",
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left rounded-lg border px-4 py-3 transition-colors hover:bg-[var(--bg-hover)]"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg-elevated)",
          color: "var(--fg-muted)",
        }}
      >
        <span className="text-[13px]">+ Add a note about a building, unit, owner, tenant or contractor…</span>
      </button>
    );
  }

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: "var(--border)",
        background: "var(--bg-elevated)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold" style={{ color: "var(--fg)" }}>
          Add a note
        </h3>
        <button
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="text-[16px] leading-none"
          style={{ color: "var(--fg-dim)" }}
          aria-label="close"
        >
          ×
        </button>
      </div>

      <label className="block text-[11px] font-mono mb-1" style={{ color: "var(--fg-dim)" }}>
        About
      </label>
      <select
        value={entity}
        onChange={(e) => setEntity(e.target.value)}
        className="w-full rounded border px-2 py-1.5 text-[13px] mb-3 font-mono"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg)",
          color: "var(--fg)",
        }}
      >
        {TYPE_ORDER.map((t) => {
          const items = grouped.get(t);
          if (!items || items.length === 0) return null;
          return (
            <optgroup key={t} label={TYPE_LABELS[t] ?? t}>
              {items.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} — {e.id}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>

      <label className="block text-[11px] font-mono mb-1" style={{ color: "var(--fg-dim)" }}>
        Note
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Met with the owner today. They confirmed the elevator inspection date is moved to May 14."
        rows={4}
        className="w-full rounded border px-3 py-2 text-[13px] leading-relaxed resize-none focus:outline-none focus:ring-2"
        style={{
          borderColor: "var(--border)",
          background: "var(--bg)",
          color: "var(--fg)",
        }}
      />

      <div className="flex items-center justify-between mt-3">
        <div className="text-[11px] font-mono" style={{ color: "var(--fg-dim)" }}>
          Stored as <code>kind=note</code> · {text.trim().length} chars
        </div>
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          className="px-4 py-1.5 rounded text-[12px] font-medium transition-colors disabled:opacity-50"
          style={{ background: "var(--brand)", color: "white" }}
        >
          {busy ? "Ingesting…" : "Save note"}
        </button>
      </div>

      {result && !result.error && (
        <div
          className="mt-3 text-[12px] rounded border px-3 py-2"
          style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--fg-muted)" }}
        >
          Saved. {result.inserted ?? result.ingested ?? 0} fact
          {(result.inserted ?? result.ingested ?? 0) === 1 ? "" : "s"} extracted
          {result.conflicts && result.conflicts.length > 0
            ? `, ${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"}`
            : ""}
          .
        </div>
      )}
      {result?.error && (
        <div
          className="mt-3 text-[12px] rounded border px-3 py-2"
          style={{ borderColor: "var(--danger)", background: "var(--bg)", color: "var(--danger)" }}
        >
          {result.error}
        </div>
      )}
    </div>
  );
}
