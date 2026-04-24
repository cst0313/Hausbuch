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
      <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-3">
        <Link
          href="/"
          className="transition-opacity hover:opacity-80 shrink-0"
          aria-label="Hausbuch home"
        >
          <HausbuchMark size={18} />
        </Link>

        <div className="flex items-center gap-0.5 md:gap-1 text-[13px] overflow-x-auto no-scrollbar">
          {PRIMARY.map((item) => {
            const active = item.matchPrefix
              ? path?.startsWith(item.matchPrefix)
              : path === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="nav-link px-2.5 md:px-3 py-1.5 rounded-md transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]"
                style={{
                  color: active ? "var(--fg)" : "var(--nav-fg)",
                  background: active ? "var(--bg-elevated)" : "transparent",
                }}
              >
                {t(item.key)}
              </Link>
            );
          })}
          <span
            className="hidden md:block mx-2 h-4 w-px"
            style={{ background: "var(--border-muted)" }}
            aria-hidden
          />
          {SECONDARY.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="hidden md:inline-flex px-2 py-1.5 rounded-md transition-colors text-[12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)]"
              style={{ color: "var(--nav-fg-dim)" }}
            >
              {t(item.key)}
            </Link>
          ))}
          <span className="ml-2 md:ml-3 shrink-0">
            <LocaleToggle />
          </span>
        </div>
      </div>
    </nav>
  );
}
