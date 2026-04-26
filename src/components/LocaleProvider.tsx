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
  "nav.dashboard": { en: "Dashboard", de: "Übersicht" },
  "nav.inbox": { en: "Inbox", de: "Posteingang" },
  "nav.queue": { en: "Queue", de: "Warteschlange" },
  "nav.audit": { en: "Audit", de: "Audit" },
  "nav.docs": { en: "Docs", de: "Dokumentation" },
  "nav.research": { en: "Research", de: "Forschung" },
  "nav.sandbox": { en: "Sandbox", de: "Sandbox" },

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
  "inbox.heading": { en: "Open items", de: "Vorgangsliste" },
  "inbox.heading.subtitle": {
    en: "Open items, prioritized by urgency. Recommended next steps per item.",
    de: "Offene Vorgänge, priorisiert nach Dringlichkeit. Empfohlene nächste Schritte pro Vorgang.",
  },
  "inbox.count": { en: "items", de: "Vorgänge" },
  "inbox.loading": { en: "Loading items…", de: "Lade Vorgänge…" },
  "inbox.error": { en: "Error:", de: "Fehler:" },
  "inbox.draft.to": { en: "To:", de: "An:" },
  "inbox.draft.subject": { en: "Subject:", de: "Betreff:" },
  "inbox.draft.drafting": { en: "Gemini drafting…", de: "Gemini erstellt Entwurf…" },
  "inbox.draft.copy": { en: "Copy", de: "Kopieren" },
  "inbox.email_thread.one": { en: "email in thread", de: "E-Mail im Verlauf" },
  "inbox.email_thread.many": { en: "emails in thread", de: "E-Mails im Verlauf" },
  "inbox.more": { en: "more", de: "weitere" },
  "inbox.severity.critical": { en: "Critical", de: "Kritisch" },
  "inbox.severity.high": { en: "High", de: "Hoch" },
  "inbox.severity.medium": { en: "Medium", de: "Mittel" },
  "inbox.severity.low": { en: "Low", de: "Niedrig" },
  "inbox.entity.tenant": { en: "Tenant", de: "Mieter" },
  "inbox.entity.owner": { en: "Owner", de: "Eigentümer" },
  "inbox.entity.contractor": { en: "Contractor", de: "Dienstleister" },
  "inbox.entity.unit": { en: "Unit", de: "Einheit" },
  "inbox.entity.building": { en: "Building", de: "Gebäude" },
  "inbox.entity.weg": { en: "WEG", de: "WEG" },

  "audit.heading": { en: "Audit Log", de: "Audit-Log" },
  "audit.subtitle": {
    en: "Every system action — transparent and replayable. No silent step.",
    de: "Jede Aktion des Systems — transparent und nachvollziehbar. Kein stiller Arbeitsschritt.",
  },
  "audit.filter.all": { en: "All", de: "Alle" },
  "audit.loading": { en: "Loading…", de: "Lade…" },
  "audit.empty": {
    en: "No actions recorded yet. Actions are logged on ingest, queries, and approvals.",
    de: "Noch keine Aktionen aufgezeichnet. Aktionen werden bei Ingest, Abfragen und Genehmigungen protokolliert.",
  },
  "audit.input": { en: "INPUT", de: "EINGABE" },
  "audit.output": { en: "OUTPUT", de: "AUSGABE" },

  // ── Dashboard chrome ─────────────────────────────────────────────────────
  "dash.greeting.morning":   { en: "Good morning.",   de: "Guten Morgen." },
  "dash.greeting.afternoon": { en: "Good afternoon.", de: "Guten Tag." },
  "dash.greeting.evening":   { en: "Good evening.",   de: "Guten Abend." },

  "dash.headline.thing.singular": { en: "thing",  de: "Vorgang" },
  "dash.headline.thing.plural":   { en: "things", de: "Vorgänge" },
  "dash.headline.needs.singular": { en: "needs",  de: "benötigt" },
  "dash.headline.needs.plural":   { en: "need",   de: "benötigen" },
  "dash.headline.tail":           { en: "a decision today.", de: "heute eine Entscheidung." },
  "dash.headline.coda":           { en: "What needs you next?", de: "Was braucht Sie als Nächstes?" },

  "dash.lede.before_kbd": {
    en: "Triage from the top. Drafts are ready where the path was obvious. Reputation flags are loaded. Press",
    de: "Triagieren Sie von oben. Entwürfe sind bereit, wo der Weg klar war. Reputationsflags sind geladen. Drücken Sie",
  },
  "dash.lede.after_kbd": {
    en: "to find anything across",
    de: "um in",
  },
  "dash.lede.buildings_suffix": {
    en: "buildings.",
    de: "Gebäuden zu suchen.",
  },

  "dash.kpi.open_recs":       { en: "Open recommendations", de: "Offene Empfehlungen" },
  "dash.kpi.critical":        { en: "Critical",             de: "Kritisch" },
  "dash.kpi.drafts":          { en: "Drafts ready to send", de: "Entwürfe versandbereit" },
  "dash.kpi.streams":         { en: "Streams in flight",    de: "Aktive Vorgänge" },
  "dash.kpi.resolved":        { en: "Resolved today",       de: "Heute erledigt" },
  "dash.kpi.queue":           { en: "Open queue",           de: "Offene Warteschlange" },

  "dash.kpi.crit_below_critical": { en: "{n} critical · {m} below",     de: "{n} kritisch · {m} darunter" },
  "dash.kpi.respond_today":       { en: "respond today",                  de: "heute beantworten" },
  "dash.kpi.all_clear":            { en: "all clear",                      de: "alles klar" },
  "dash.kpi.needs_draft":          { en: "needs draft",                    de: "Entwurf nötig" },
  "dash.kpi.last_24h":              { en: "last 24h",                        de: "letzte 24 Std." },
  "dash.kpi.pace_target":           { en: "pace · target",                   de: "Tempo · Ziel" },
  "dash.kpi.prioritized":           { en: "prioritized",                     de: "priorisiert" },
  "dash.kpi.review_under_30s":      { en: "review under 30s",                de: "in 30 Sek. prüfen" },

  "dash.section.today":      { en: "Today",                de: "Heute" },
  "dash.section.today.sub":  { en: "{n} threads need a decision", de: "{n} Vorgänge benötigen eine Entscheidung" },
  "dash.section.view_all":   { en: "View all in Inbox →", de: "Alle im Posteingang →" },
  "dash.section.in_flight":  { en: "In flight",           de: "In Bearbeitung" },
  "dash.section.in_flight.sub": { en: "last 24h",         de: "letzte 24 Std." },
  "dash.section.activity":   { en: "Latest activity",     de: "Neueste Aktivität" },
  "dash.section.activity.sub": { en: "last 10 actions",   de: "letzte 10 Aktionen" },
  "dash.section.refresh":    { en: "auto-refresh 30s",    de: "auto-aktualisierung 30s" },
  "dash.section.open_audit": { en: "Open audit →",        de: "Audit öffnen →" },
  "dash.section.empty":      { en: "Nothing pending — quiet day.", de: "Nichts offen — ruhiger Tag." },
  "dash.section.no_streams": { en: "No active streams in the last 24 hours.",
                               de: "Keine aktiven Vorgänge in den letzten 24 Std." },

  "dash.severity.critical": { en: "Critical · respond now", de: "Kritisch · sofort reagieren" },
  "dash.severity.high":     { en: "High · today",            de: "Hoch · heute" },
  "dash.severity.medium":   { en: "Medium · this week",      de: "Mittel · diese Woche" },
  "dash.severity.low":      { en: "Low · backlog",           de: "Niedrig · Backlog" },

  "dash.recrow.step":  { en: "Step {n} of {m}", de: "Schritt {n} von {m}" },
  "dash.recrow.review":   { en: "Review",  de: "Prüfen" },
  "dash.recrow.msg":   { en: "msg",   de: "Nachr." },
  "dash.recrow.msgs":  { en: "msgs",  de: "Nachr." },

  "dash.dock.ask":   { en: "Ask anything…", de: "Frag uns alles…" },
  "audit.search.placeholder": {
    en: "Search emails, sources, entities, or any payload text…",
    de: "Suche nach E-Mails, Quellen, Entitäten oder Inhalten…",
  },
  "audit.view.flat": { en: "Flat", de: "Flach" },
  "audit.view.stream": { en: "Per task", de: "Pro Vorgang" },
  "audit.stream.steps": { en: "steps", de: "Schritte" },
  "audit.stream.duration": { en: "since first action", de: "seit erstem Schritt" },
  "audit.stream.latest": { en: "latest", de: "zuletzt" },

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
