// path: src/components/Nav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LocaleToggle } from "./LocaleToggle";
import { useLocale } from "./LocaleProvider";

const PRIMARY = [
  { href: "/dashboard", key: "nav.dashboard" },
  { href: "/sandbox", key: "nav.sandbox" },
  { href: "/research", key: "nav.research" },
  { href: "/technical", key: "nav.docs" },
];

export function Nav({
  onOpenSearch,
  rightSlot,
}: { onOpenSearch?: () => void; rightSlot?: React.ReactNode } = {}) {
  const { t } = useLocale();
  const path = usePathname();

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        height: 56,
        padding: "0 24px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg)",
        position: "sticky",
        top: 0,
        zIndex: 50,
        gap: 32,
      }}
    >
      <Link
        href="/"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 22,
          letterSpacing: "-0.01em",
          color: "var(--fg)",
          textDecoration: "none",
          display: "flex",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--brand)",
            display: "inline-block",
            transform: "translateY(-2px)",
          }}
        />
        Hausbuch
      </Link>

      <nav style={{ display: "flex", gap: 4 }}>
        {PRIMARY.map((item) => {
          const active = path === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              style={{
                textDecoration: "none",
                padding: "8px 12px",
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                color: active ? "var(--fg)" : "var(--fg-muted)",
                background: active ? "var(--bg-hover)" : "transparent",
              }}
            >
              {t(item.key)}
            </Link>
          );
        })}
      </nav>

      {/* Search trigger */}
      {onOpenSearch && (
        <button
          onClick={onOpenSearch}
          aria-label="Ask the agent"
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
            height: 36,
            padding: "0 8px 0 14px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--fg-dim)",
            fontSize: 13,
            minWidth: 280,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 2.2c-2 0-3.4 1.4-3.4 3.4 0 1.1.5 2 1.4 2.7-.4.3-.7.7-.9 1.2-.4.9-.5 1.7-.5 2.5h7c0-.8-.1-1.6-.5-2.5-.2-.5-.5-.9-.9-1.2.9-.7 1.4-1.6 1.4-2.7 0-2-1.4-3.4-3.4-3.4z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
            <circle cx="8" cy="13.6" r="0.8" fill="currentColor" />
          </svg>
          <span style={{ flex: 1, textAlign: "left" }}>Ask our agent…</span>
          <span
            className="mono"
            style={{
              fontSize: 11,
              padding: "2px 6px",
              background: "var(--bg-hover)",
              border: "1px solid var(--border-muted)",
              borderRadius: 4,
              color: "var(--fg-muted)",
            }}
          >
            ⌘K
          </span>
        </button>
      )}
      {!onOpenSearch && <span style={{ marginLeft: "auto" }} />}

      {rightSlot}
      <LocaleToggle />
    </header>
  );
}
