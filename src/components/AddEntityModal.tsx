// path: src/components/AddEntityModal.tsx
"use client";

import { useEffect, useState } from "react";

type EntityKind = "contractor" | "tenant" | "owner" | "unit" | "building";

type FieldSpec = {
  key: string; // becomes identity.<key>
  label: string;
  placeholder?: string;
  required?: boolean;
};

type KindSpec = {
  label: string;
  description: string;
  icon: string;
  fields: FieldSpec[];
  /** If true, the picker also lets the user choose a parent entity. */
  parentType?: "weg" | "building";
};

const KIND_SPECS: Record<EntityKind, KindSpec> = {
  contractor: {
    label: "Handyman / contractor",
    description: "Sanitär, Schlüsseldienst, Heizung — anyone you dispatch.",
    icon: "▢",
    fields: [
      { key: "firma", label: "Firma", placeholder: "Klempner Schmidt GmbH", required: true },
      { key: "branche", label: "Trade", placeholder: "Sanitär · Wasserschaden" },
      { key: "ansprechpartner", label: "Contact person", placeholder: "Herr Schmidt" },
      { key: "email", label: "Email", placeholder: "info@klempner-schmidt.de" },
      { key: "telefon", label: "Phone", placeholder: "+49 30 12345678" },
      { key: "address", label: "Address", placeholder: "Mustergasse 1, 10405 Berlin" },
    ],
  },
  tenant: {
    label: "Tenant",
    description: "A renter — links to a unit you already manage.",
    icon: "◊",
    fields: [
      { key: "name", label: "Full name", placeholder: "Max Mustermann", required: true },
      { key: "email", label: "Email", placeholder: "max@example.com" },
      { key: "telefon", label: "Phone", placeholder: "+49 30 12345678" },
    ],
  },
  owner: {
    label: "Owner / Eigentümer",
    description: "WEG owner — single property or portfolio.",
    icon: "◇",
    fields: [
      { key: "name", label: "Full name", placeholder: "Anna Eigentümer", required: true },
      { key: "firma", label: "Firma (if any)", placeholder: "Immo Holding GmbH" },
      { key: "email", label: "Email", placeholder: "anna@example.com" },
      { key: "telefon", label: "Phone" },
      { key: "address", label: "Address", placeholder: "Strasse 1, PLZ Stadt" },
    ],
  },
  unit: {
    label: "Unit / Wohnung",
    description: "A single apartment or commercial unit. Pick the building.",
    icon: "▦",
    parentType: "building",
    fields: [
      { key: "name", label: "Unit number", placeholder: "WE 32", required: true },
      { key: "lage", label: "Lage", placeholder: "EG links" },
      { key: "typ", label: "Typ", placeholder: "Wohnung / Gewerbe" },
      { key: "flaeche", label: "Fläche (m²)", placeholder: "62" },
      { key: "zimmer", label: "Zimmer", placeholder: "2" },
    ],
  },
  building: {
    label: "Building",
    description: "Adds a building under the WEG.",
    icon: "⛶",
    parentType: "weg",
    fields: [
      { key: "name", label: "Hausnummer / name", placeholder: "Haus 26A", required: true },
      { key: "address", label: "Address", placeholder: "Immanuelkirchstraße 26, 10405 Berlin" },
      { key: "etagen", label: "Etagen", placeholder: "5" },
      { key: "einheiten", label: "Einheiten", placeholder: "12" },
      { key: "baujahr", label: "Baujahr", placeholder: "1908" },
    ],
  },
};

type ParentOption = { id: string; name: string };

export function AddEntityModal({
  open,
  onClose,
  onCreated,
  initialKind = "contractor",
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (entityId: string) => void;
  initialKind?: EntityKind;
}) {
  const [kind, setKind] = useState<EntityKind>(initialKind);
  const [values, setValues] = useState<Record<string, string>>({});
  const [parentId, setParentId] = useState<string>("");
  const [parentOptions, setParentOptions] = useState<ParentOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setKind(initialKind);
      setValues({});
      setParentId("");
      setError(null);
    }
  }, [open, initialKind]);

  // Load parent options when needed
  useEffect(() => {
    if (!open) return;
    const spec = KIND_SPECS[kind];
    if (!spec.parentType) {
      setParentOptions([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/entities?type=${spec.parentType}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const opts = (d.entities ?? []).map((e: { id: string; name: string }) => ({
          id: e.id,
          name: e.name,
        }));
        setParentOptions(opts);
        // Default to "no parent" so a building can be added with no WEG
        // and units can be attached later. The user can pick one if they want.
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const spec = KIND_SPECS[kind];

  const handleSubmit = async () => {
    setError(null);

    // Required-field check
    for (const f of spec.fields) {
      if (f.required && !(values[f.key] ?? "").trim()) {
        setError(`${f.label} is required.`);
        return;
      }
    }

    // Build payload
    const isPlaceKind = kind === "unit" || kind === "building";
    const nameField = isPlaceKind ? values["name"] : values["name"] ?? values["firma"];
    if (!nameField || !nameField.trim()) {
      setError("Please provide a name for this entity.");
      return;
    }

    const identity: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = (values[f.key] ?? "").trim();
      if (!v) continue;
      // 'name' becomes the entity's display name, not an identity fact key.
      // For contractor, store firma; for tenant/owner, name is duplicated as identity.name.
      if (f.key === "name") {
        identity["name"] = v;
        continue;
      }
      identity[f.key] = v;
    }

    setSubmitting(true);
    try {
      const r = await fetch("/api/entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: kind,
          name: nameField.trim(),
          // Optional parent — null means top-level (e.g. a building added before
          // any WEG exists). Units attach to whatever buildings are around.
          parent_id: spec.parentType && parentId ? parentId : undefined,
          identity,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error ?? `Server error (${r.status})`);
        return;
      }
      onCreated?.(data.entity.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 240,
        background: "rgba(28,26,22,0.42)",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "8vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxWidth: "94%",
          maxHeight: "84vh",
          background: "var(--bg)",
          borderRadius: 12,
          border: "1px solid var(--border-muted)",
          boxShadow: "0 24px 80px rgba(28,26,22,0.20)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
            <div>
              <p
                className="mono"
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: "var(--brand)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Add new
              </p>
              <h2
                style={{
                  margin: "4px 0 0",
                  fontSize: 22,
                  fontWeight: 500,
                  letterSpacing: "-0.02em",
                }}
              >
                {spec.label}
              </h2>
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 13,
                  color: "var(--fg-muted)",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                }}
              >
                {spec.description}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--fg-muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "inherit",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Kind selector */}
          <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
            {(Object.keys(KIND_SPECS) as EntityKind[]).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setKind(k);
                  setValues({});
                  setError(null);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 10px",
                  borderRadius: 6,
                  border:
                    "1px solid " +
                    (k === kind ? "var(--brand)" : "var(--border-muted)"),
                  background: k === kind ? "var(--brand-wash)" : "var(--bg)",
                  color: k === kind ? "var(--brand)" : "var(--fg-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <span className="mono" style={{ fontSize: 12 }}>
                  {KIND_SPECS[k].icon}
                </span>
                {KIND_SPECS[k].label.split("/")[0].trim()}
              </button>
            ))}
          </div>
        </div>

        {/* Fields */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 24px 8px" }}>
          {spec.parentType && (
            <FieldRow
              label={
                spec.parentType === "weg"
                  ? "WEG (optional)"
                  : "Building (optional)"
              }
            >
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                style={selectStyle}
              >
                <option value="">
                  {spec.parentType === "weg"
                    ? "— no WEG (top-level building) —"
                    : "— no building yet —"}
                </option>
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FieldRow>
          )}

          {spec.fields.map((f) => (
            <FieldRow key={f.key} label={f.label} required={f.required}>
              <input
                type="text"
                value={values[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                style={inputStyle}
              />
            </FieldRow>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: "space-between",
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: error ? "var(--rep-avoid)" : "var(--fg-dim)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
              flex: 1,
            }}
          >
            {error ? error : "Saved as stammdaten · revocable from /audit"}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: "8px 14px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--fg-muted)",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                padding: "8px 14px",
                borderRadius: 6,
                border: "1px solid var(--brand)",
                background: submitting ? "var(--brand-wash)" : "var(--brand)",
                color: submitting ? "var(--brand)" : "white",
                fontSize: 13,
                fontWeight: 500,
                cursor: submitting ? "default" : "pointer",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {submitting ? "Saving…" : `Add ${spec.label.split("/")[0].trim().toLowerCase()}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr",
        gap: 14,
        alignItems: "center",
        padding: "8px 0",
      }}
    >
      <label
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--fg-dim)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
        {required && <span style={{ color: "var(--brand)", marginLeft: 4 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  color: "var(--fg)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};
