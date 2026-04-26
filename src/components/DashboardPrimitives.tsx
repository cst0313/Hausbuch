// path: src/components/DashboardPrimitives.tsx
"use client";

import type { ReactNode } from "react";

// ── Severity dot ─────────────────────────────────────────────────────────────

const SEV_COLORS: Record<string, string> = {
  critical: "var(--critical)",
  high: "var(--high)",
  medium: "var(--fg-dim)",
  low: "var(--fg-dim)",
  info: "var(--info)",
  ok: "var(--brand)",
};

export function SevDot({ sev = "medium", size = 6 }: { sev?: string; size?: number }) {
  return (
    <span
      className="dot"
      style={{ background: SEV_COLORS[sev] ?? "var(--fg-dim)", width: size, height: size }}
    />
  );
}

// ── Reputation chip ──────────────────────────────────────────────────────────

export type Band = "avoid" | "neutral" | "trusted";

export function RepChip({
  band = "neutral",
  score,
  incidents = 0,
  mahnung = 0,
  compact = false,
}: {
  band?: Band;
  score?: number;
  incidents?: number;
  mahnung?: number;
  compact?: boolean;
}) {
  const colors: Record<Band, { bg: string; fg: string; dot: string }> = {
    avoid: { bg: "var(--critical-wash)", fg: "var(--critical)", dot: "var(--critical)" },
    neutral: { bg: "var(--bg-elevated)", fg: "var(--fg-muted)", dot: "var(--fg-dim)" },
    trusted: { bg: "var(--brand-wash)", fg: "var(--brand)", dot: "var(--brand)" },
  };
  const c = colors[band] ?? colors.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: 4,
        background: c.bg,
        color: c.fg,
        whiteSpace: "nowrap",
      }}
    >
      <span className="dot" style={{ background: c.dot, width: 5, height: 5 }} />
      <span style={{ textTransform: "lowercase" }}>{band}</span>
      {score !== undefined && <span style={{ opacity: 0.7 }}>· {score.toFixed(2)}</span>}
      {!compact && incidents > 0 && <span style={{ opacity: 0.7 }}>· {incidents} open</span>}
      {!compact && mahnung > 0 && <span style={{ opacity: 0.7 }}>· {mahnung} mahnung</span>}
    </span>
  );
}

// ── Cala chip ────────────────────────────────────────────────────────────────

export function CalaChip({ label = "Verified via Cala" }: { label?: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        padding: "2px 7px",
        borderRadius: 4,
        background: "var(--brand-wash)",
        color: "var(--brand)",
      }}
    >
      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
        <path
          d="M2 6.5L4.8 9L10 3"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </span>
  );
}

// ── Partner badge ────────────────────────────────────────────────────────────

export function PartnerBadge({ name }: { name: string }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        padding: "1px 6px",
        borderRadius: 3,
        background: "var(--bg-elevated)",
        color: "var(--fg-muted)",
        border: "1px solid var(--border)",
      }}
    >
      {name}
    </span>
  );
}

// ── Glyph by entity type ─────────────────────────────────────────────────────

const GLYPHS: Record<string, string> = {
  tenant: "◊",
  contractor: "▢",
  owner: "◇",
  unit: "▦",
  building: "⛶",
  recommendation: "◐",
  audit: "⌗",
  agent: "✦",
};

export function Glyph({ type, size = 13, color }: { type: string; size?: number; color?: string }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: size,
        color: color ?? "var(--fg-muted)",
        display: "inline-block",
        width: size + 2,
        textAlign: "center",
      }}
    >
      {GLYPHS[type] ?? "·"}
    </span>
  );
}

// ── Section heading ──────────────────────────────────────────────────────────

export function SectionHead({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2
          style={{
            fontSize: 13,
            fontWeight: 500,
            margin: 0,
            letterSpacing: 0.02,
            textTransform: "uppercase",
            color: "var(--fg-muted)",
          }}
        >
          {title}
        </h2>
        {sub && (
          <span
            style={{ fontSize: 11, color: "var(--fg-dim)", fontFamily: "var(--font-mono)" }}
          >
            {sub}
          </span>
        )}
      </div>
      {right}
    </div>
  );
}

// ── KPI tile ─────────────────────────────────────────────────────────────────

export function Kpi({
  label,
  value,
  sub,
  accent = false,
  onClick,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 0,
        padding: "18px 20px",
        background: accent ? "var(--brand-wash)" : "var(--bg-elevated)",
        border: `1px solid ${accent ? "var(--brand-line)" : "var(--border)"}`,
        borderRadius: 8,
        cursor: "pointer",
        transition: "background 120ms",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--fg-muted)",
          letterSpacing: 0.02,
          textTransform: "uppercase",
          marginBottom: 8,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 32,
          fontWeight: 500,
          letterSpacing: "-0.035em",
          lineHeight: 1,
          color: accent ? "var(--brand)" : "var(--fg)",
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontSize: 11,
            color: "var(--fg-muted)",
            marginTop: 8,
            fontFamily: "var(--font-mono)",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Btn ──────────────────────────────────────────────────────────────────────

export function Btn({
  children,
  variant = "ghost",
  size = "md",
  onClick,
  style,
}: {
  children: ReactNode;
  variant?: "primary" | "ghost" | "subtle" | "danger";
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  const variants = {
    primary: { bg: "var(--brand)", fg: "#fff", border: "var(--brand)" },
    ghost: { bg: "transparent", fg: "var(--fg)", border: "var(--border-muted)" },
    subtle: { bg: "var(--bg-elevated)", fg: "var(--fg)", border: "var(--border)" },
    danger: { bg: "transparent", fg: "var(--critical)", border: "var(--border-muted)" },
  } as const;
  const sizes = {
    sm: { p: "4px 8px", fs: 11 },
    md: { p: "7px 12px", fs: 12 },
    lg: { p: "10px 16px", fs: 13 },
  } as const;
  const v = variants[variant];
  const s = sizes[size];
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: s.p,
        fontSize: s.fs,
        fontWeight: 500,
        letterSpacing: "-0.005em",
        background: v.bg,
        color: v.fg,
        border: `1px solid ${v.border}`,
        borderRadius: 6,
        cursor: "pointer",
        transition: "background 120ms",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
