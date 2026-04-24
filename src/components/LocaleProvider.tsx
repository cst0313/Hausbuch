// path: src/components/LocaleProvider.tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Locale = "en" | "de";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

const STORAGE_KEY = "hausbuch.locale";

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored === "en" || stored === "de") {
      setLocaleState(stored);
      document.documentElement.lang = stored;
    }
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
  };

  const t = useMemo(() => {
    return (key: string) => {
      const entry = copy[key];
      if (!entry) return key;
      return entry[locale] ?? entry.en ?? key;
    };
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>");
  return ctx;
}

// ─────────────────────────────────────────────
// Copy dictionary
// Keys are ASCII-dotted; values are { en, de }.
// Add keys here; components call t("key").
// ─────────────────────────────────────────────
const copy: Record<string, { en: string; de: string }> = {
  "nav.inbox": { en: "Inbox", de: "Posteingang" },
  "nav.queue": { en: "Queue", de: "Warteschlange" },
  "nav.context": { en: "Buildings", de: "Gebäude" },
  "nav.audit": { en: "Audit", de: "Audit" },
  "nav.research": { en: "Research", de: "Forschung" },

  "hero.eyebrow": { en: "The context engine for property managers", de: "Die Kontextmaschine für Hausverwalter" },
  "hero.title": {
    en: "One document\nper building.",
    de: "Ein Dokument\npro Gebäude.",
  },
  "hero.title.accent": {
    en: "Updates itself.",
    de: "Aktualisiert sich selbst.",
  },
  "hero.subtitle": {
    en: "90% of property managers react. Hausbuch remembers. Every email, PDF, invoice and Slack message about a building lands in one living, self-updating Context.md — with every fact cited, every update surgical, and every action replayable.",
    de: "90 % der Hausverwalter reagieren nur. Hausbuch erinnert sich. Jede E-Mail, jedes PDF, jede Rechnung und jede Slack-Nachricht zu einem Gebäude landet in einem lebenden, selbst-aktualisierenden Context.md — mit jeder Tatsache belegt, jeder Aktualisierung chirurgisch präzise und jeder Aktion wiederholbar.",
  },
  "hero.cta": { en: "Open your first building", de: "Erstes Gebäude öffnen" },
  "hero.cta.secondary": { en: "See it work", de: "Live ansehen" },

  "workflows.inbox.title": { en: "Monday morning, twelve buildings", de: "Montagmorgen, zwölf Gebäude" },
  "workflows.inbox.body": {
    en: "Every Monday, Hausbuch hands you a digest per property: what's new, what needs a decision, what changed. Your weekend is safe.",
    de: "Jeden Montag erhalten Sie eine Zusammenfassung pro Objekt: was neu ist, was entschieden werden muss, was sich geändert hat. Ihr Wochenende bleibt unberührt.",
  },
  "workflows.queue.title": { en: "Propose, then approve", de: "Vorschlagen, dann bestätigen" },
  "workflows.queue.body": {
    en: "A tenant email arrives. Hausbuch reads it, proposes exactly which facts to add or supersede, and waits. You click approve. No silent rewrites.",
    de: "Eine Mieter-E-Mail trifft ein. Hausbuch liest sie, schlägt genau vor, welche Tatsachen hinzuzufügen oder zu ersetzen sind, und wartet. Sie bestätigen. Keine stillen Änderungen.",
  },
  "workflows.replay.title": { en: "Replay any moment", de: "Jeden Moment wiederholen" },
  "workflows.replay.body": {
    en: "What did you know on April 15? Drag the time scrubber. The Context.md re-renders, facts fade in and out, conflicts light up. Truth has a timeline.",
    de: "Was wussten Sie am 15. April? Ziehen Sie den Zeitregler. Das Context.md wird neu gerendert, Tatsachen erscheinen und verschwinden, Konflikte leuchten auf. Wahrheit hat eine Zeitachse.",
  },

  "proof.title": { en: "Plain English. No legalese.", de: "Klartext. Ohne Juristendeutsch." },
  "proof.body": {
    en: "The document every building should already have.",
    de: "Das Dokument, das jedes Gebäude längst haben sollte.",
  },

  "inbox.title": { en: "Inbox", de: "Posteingang" },
  "inbox.subtitle": { en: "Your Monday digest, per building.", de: "Ihre Montagsübersicht, pro Gebäude." },
  "inbox.section.new": { en: "What's new", de: "Was ist neu" },
  "inbox.section.decide": { en: "What needs a decision", de: "Was entschieden werden muss" },
  "inbox.section.changed": { en: "What changed", de: "Was sich geändert hat" },

  "queue.title": { en: "Queue", de: "Warteschlange" },
  "queue.subtitle": {
    en: "Every incoming source waits here until you approve.",
    de: "Jede eingehende Quelle wartet hier auf Ihre Bestätigung.",
  },
  "queue.approve": { en: "Approve", de: "Bestätigen" },
  "queue.reject": { en: "Reject", de: "Ablehnen" },
  "queue.edit": { en: "Edit first", de: "Erst bearbeiten" },

  "common.loading": { en: "Loading…", de: "Lädt…" },
  "common.empty": { en: "Nothing here yet.", de: "Noch nichts." },
  "common.error": { en: "Something went wrong.", de: "Etwas ist schiefgelaufen." },
};
