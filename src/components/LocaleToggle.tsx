// path: src/components/LocaleToggle.tsx
"use client";

import { useLocale } from "./LocaleProvider";

export function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex items-center rounded-md border text-[11px] font-mono"
      style={{ borderColor: "var(--border-muted)" }}
    >
      <button
        type="button"
        onClick={() => setLocale("en")}
        aria-pressed={locale === "en"}
        className="px-2 py-1 rounded-l-md transition-colors"
        style={{
          background: locale === "en" ? "var(--bg-hover)" : "transparent",
          color: locale === "en" ? "var(--fg)" : "var(--fg-muted)",
        }}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale("de")}
        aria-pressed={locale === "de"}
        className="px-2 py-1 rounded-r-md transition-colors"
        style={{
          background: locale === "de" ? "var(--bg-hover)" : "transparent",
          color: locale === "de" ? "var(--fg)" : "var(--fg-muted)",
        }}
      >
        DE
      </button>
    </div>
  );
}
