// path: src/components/Nav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HausbuchMark } from "./HausbuchMark";
import { LocaleToggle } from "./LocaleToggle";
import { useLocale } from "./LocaleProvider";

const PRIMARY = [
  { href: "/inbox", key: "nav.inbox" },
  { href: "/queue", key: "nav.queue" },
  { href: "/context/berliner-str-42", key: "nav.context", matchPrefix: "/context" },
  { href: "/audit", key: "nav.audit" },
];

const SECONDARY = [{ href: "/research", key: "nav.research" }];

export function Nav() {
  const { t } = useLocale();
  const path = usePathname();

  return (
    <nav
      className="sticky top-0 z-40 backdrop-blur-md"
      style={{
        background: "color-mix(in srgb, var(--bg) 75%, transparent)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="transition-opacity hover:opacity-80">
          <HausbuchMark size={18} />
        </Link>

        <div className="flex items-center gap-1 text-[13px]">
          {PRIMARY.map((item) => {
            const active = item.matchPrefix
              ? path?.startsWith(item.matchPrefix)
              : path === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="px-3 py-1.5 rounded-md transition-colors"
                style={{
                  color: active ? "var(--fg)" : "var(--fg-muted)",
                  background: active ? "var(--bg-elevated)" : "transparent",
                }}
              >
                {t(item.key)}
              </Link>
            );
          })}
          <span
            className="mx-2 h-4 w-px"
            style={{ background: "var(--border-muted)" }}
            aria-hidden
          />
          {SECONDARY.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-2 py-1.5 rounded-md transition-colors text-[12px]"
              style={{ color: "var(--fg-dim)" }}
            >
              {t(item.key)}
            </Link>
          ))}
          <span className="ml-3">
            <LocaleToggle />
          </span>
        </div>
      </div>
    </nav>
  );
}
