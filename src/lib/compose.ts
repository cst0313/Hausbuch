// path: src/lib/compose.ts
import type { Fact, PredicateView } from "./types";
import type { Source } from "./types";
import { fullView } from "./query";
import { ablatedView, type Ablation } from "./ablations";
import { listSources } from "./db";

/**
 * Natural-language composer for Lumen answers.
 *
 * Takes the live bitemporal view + the question + a persona ("chatbot" or
 * "drafter") and produces prose. No arrow-syntax. No raw posterior numbers
 * unless the user asks for them. Citations embedded inline.
 *
 * When Claude is available, the /api/query route uses it with our Context.md
 * as the cached system prompt. This composer is the offline fallback —
 * designed to sound like a careful human assistant, not a debug dump.
 */

export type Persona = "chatbot" | "drafter" | "plain";

export function compose(
  entity: string,
  question: string,
  persona: Persona,
  at: { at_valid?: string; at_known?: string },
  ablate: Ablation,
): { answer: string; citations: string[] } {
  const view = ablate === "none" ? fullView(entity, at) : ablatedView(entity, ablate, at);
  const sources = new Map(listSources().map((s) => [s.id, s]));
  const cites: string[] = [];

  const intent = classify(question);

  if (persona === "drafter") {
    return draftEmail(view, sources, cites, ablate);
  }

  if (persona === "chatbot") {
    if (intent === "rent-status") return rentStatusChatbot(view, sources, cites, ablate);
    if (intent === "tenant") return tenantChatbot(view, sources, cites);
    if (intent === "owner") return ownerChatbot(view, sources, cites);
    if (intent === "posterior") return posteriorChatbot(view, sources, cites);
    if (intent === "source-of") return sourceOfChatbot(question, view, sources, cites);
    if (intent === "lease-end") return leaseEndChatbot(view, sources, cites);
    if (intent === "inspection") return inspectionChatbot(view, sources, cites);
    if (intent === "tickets") return ticketsChatbot(view, sources, cites);
    if (intent === "units") return unitsChatbot(view, sources, cites);
    if (intent === "caps") return capsChatbot(view, sources, cites, ablate);
    return fallbackChatbot(view);
  }

  // persona === "plain" — canonical form used by benchmarks
  return plainAnswerCanonical(question, intent, view, sources, cites, ablate);
}

/* ----------------------------------------------------------------------------
 * Intent classification
 * -------------------------------------------------------------------------- */

type Intent =
  | "rent-status" // the combined "current + next" question
  | "rent-current"
  | "rent-next"
  | "tenant"
  | "owner"
  | "units"
  | "lease-end"
  | "inspection"
  | "tickets"
  | "posterior"
  | "source-of"
  | "caps"
  | "unknown";

function classify(q: string): Intent {
  const s = q.toLowerCase();
  const has = (w: string) => new RegExp(`\\b${w}\\b`, "i").test(q);
  const hasAny = (...ws: string[]) => ws.some(has);

  if (hasAny("posterior", "bayesian", "dawid", "probability")) return "posterior";

  const amountMatch = q.match(/€\s*[\d,.]+|\b\d{3,5}\b/);
  if (
    (hasAny("who", "whose", "which", "source") || hasAny("caps", "proposes", "announces", "says")) &&
    amountMatch &&
    hasAny("rent", "miete", "€", "eur")
  ) {
    return "source-of";
  }

  if (hasAny("cap", "caps", "capped", "limit", "mietpreisbremse", "statute")) return "caps";

  if (hasAny("rent", "miete", "€", "eur")) {
    const mentionsNext = hasAny("next", "upcoming", "future", "june", "2026-06");
    const mentionsCurrent = hasAny("current", "currently", "now", "today");
    if (mentionsNext && mentionsCurrent) return "rent-status";
    if (mentionsNext) return "rent-next";
    if (mentionsCurrent || /what('?s| is) the rent/i.test(q) || /what was the rent/i.test(q))
      return "rent-current";
    return "rent-current";
  }

  if (has("owner") || (has("owns") && !has("tenancy"))) return "owner";
  if (hasAny("units", "apartments", "apts", "homes") || (has("how") && has("many"))) return "units";
  if ((hasAny("lease", "tenancy") && hasAny("expire", "expires", "end", "ends", "until")) || has("befristet"))
    return "lease-end";
  if (hasAny("inspection", "inspected", "inspect")) return "inspection";
  if (hasAny("ticket", "tickets", "maintenance", "issues", "open")) return "tickets";
  if (
    hasAny("tenant", "resident") ||
    (has("who") && hasAny("lives", "renting", "occupies")) ||
    (hasAny("tenancy", "lease") && hasAny("begin", "began", "start", "started"))
  ) {
    return "tenant";
  }
  return "unknown";
}

/* ----------------------------------------------------------------------------
 * Chatbot composers — natural English prose
 * -------------------------------------------------------------------------- */

type View = { current: Record<string, PredicateView>; upcoming: Record<string, PredicateView> };

function rentStatusChatbot(
  view: View,
  sources: Map<string, Source>,
  cites: string[],
  ablate: Ablation,
): { answer: string; citations: string[] } {
  const parts: string[] = [];
  const cur = view.current["tenancy.rent.base"];

  if (cur?.kind === "single") {
    const f = cur.fact;
    const s = sources.get(f.source);
    if (s) cites.push(s.title);
    const validFrom = f.valid_from ? ` in force since ${formatDate(f.valid_from)}` : "";
    parts.push(`The current rent is ${fmtEur(f.value)} per month${validFrom}, per the lease (${s?.title ?? f.source}).`);
  } else if (!cur) {
    parts.push(`No current rent on record for this property.`);
  }

  const next = view.upcoming["tenancy.rent.next"] ?? view.current["tenancy.rent.next"];
  if (!next) {
    parts.push(`No rent change has been announced for next month — the current lease runs its course.`);
  } else if (next.kind === "single") {
    const f = next.fact;
    const s = sources.get(f.source);
    if (s) cites.push(s.title);
    const when = f.valid_from ? ` effective ${formatDate(f.valid_from)}` : "";
    if (ablate === "conflict") {
      parts.push(
        `For next month, I see a single announced value of ${fmtEur(f.value)}${when}, from ${s?.title ?? f.source}. ` +
          `(Note: conflict resolution is disabled in this ablation — any disagreeing source would be hidden.)`,
      );
    } else {
      parts.push(
        `For next month, the lease shows a rent of ${fmtEur(f.value)}${when}, announced in ${s?.title ?? f.source}.`,
      );
    }
  } else {
    // conflict
    const top = next.posterior.entries[0];
    const topFact = next.facts.find((x) => String(x.value) === top.value) ?? next.facts[0];
    const topSrc = sources.get(topFact.source);
    const otherFact = next.facts.find((x) => String(x.value) !== top.value);
    if (topSrc) cites.push(topSrc.title);

    if (!otherFact) {
      // All conflicting facts reduced to the same value — render as single
      parts.push(
        `For next month, multiple sources concur on ${fmtEur(topFact.value)} ` +
          `(${topSrc?.title ?? topFact.source}${topFact.valid_from ? `, effective ${formatDate(topFact.valid_from)}` : ""}).`,
      );
    } else {
      const otherSrc = sources.get(otherFact.source);
      if (otherSrc) cites.push(otherSrc.title);
      const pTopPct = Math.round(top.probability * 100);
      const pOther = next.posterior.entries[1];
      const pOtherPct = pOther ? Math.round(pOther.probability * 100) : 100 - pTopPct;
      parts.push(
        `For next month, the situation is contested. ` +
          `${capitalize(otherSrc?.title ?? otherFact.source)} proposes ${fmtEur(otherFact.value)}` +
          `${otherFact.valid_from ? ` effective ${formatDate(otherFact.valid_from)}` : ""}, ` +
          `but ${topSrc?.title ?? topFact.source} notes that the enforceable amount is ${fmtEur(topFact.value)} ` +
          `(citing the statute). Weighing source reliability ` +
          `(${topSrc?.source_prior.toFixed(2) ?? "?"} vs ${otherSrc?.source_prior.toFixed(2) ?? "?"}), ` +
          `the Bayesian posterior favors ${fmtEur(topFact.value)} at ${pTopPct}% against ${fmtEur(otherFact.value)} at ${pOtherPct}%. ` +
          `I'd treat ${fmtEur(topFact.value)} as the operative figure pending resolution.`,
      );
    }
  }

  return { answer: parts.join(" "), citations: [...new Set(cites)] };
}

function tenantChatbot(view: View, sources: Map<string, Source>, cites: string[]) {
  const v = view.current["tenancy.tenant"];
  if (!v) return { answer: "There's no tenant on record for this property.", citations: [] };
  if (v.kind !== "single") return { answer: "Multiple tenant records exist for this period — check the conflict panel.", citations: [] };
  const f = v.fact;
  const s = sources.get(f.source);
  if (s) cites.push(s.title);
  const start = view.current["tenancy.start"];
  const startPart =
    start?.kind === "single" ? ` They moved in on ${formatDate(String(start.fact.value))}.` : "";
  return {
    answer: `The tenant is ${f.value}, per ${s?.title ?? f.source}.${startPart}`,
    citations: [...new Set(cites)],
  };
}

function ownerChatbot(view: View, sources: Map<string, Source>, cites: string[]) {
  const v = view.current["identity.owner"];
  if (v?.kind !== "single") return { answer: "No owner on record.", citations: [] };
  const f = v.fact;
  const s = sources.get(f.source);
  if (s) cites.push(s.title);
  return {
    answer: `The building is owned by ${f.value}, recorded in the ${s?.title ?? f.source}.`,
    citations: [...new Set(cites)],
  };
}

function posteriorChatbot(view: View, sources: Map<string, Source>, cites: string[]) {
  const v = view.upcoming["tenancy.rent.next"] ?? view.current["tenancy.rent.next"];
  if (v?.kind !== "conflict") {
    return {
      answer: "No live conflicts on this property — the posterior is trivially the single known value.",
      citations: [],
    };
  }
  const entries = v.posterior.entries
    .map((e) => `${fmtEur(e.value)} at ${(e.probability * 100).toFixed(0)}%`)
    .join(", and ");
  for (const f of v.facts) {
    const s = sources.get(f.source);
    if (s) cites.push(s.title);
  }
  return {
    answer:
      `On the contested rent.next: the posterior is ${entries}, computed via Dawid-Skene (1979) ` +
      `using source priors of ${v.facts
        .map((f) => {
          const s = sources.get(f.source);
          return `${s?.title ?? f.source} (${s?.source_prior.toFixed(2)})`;
        })
        .join(" and ")}.`,
    citations: [...new Set(cites)],
  };
}

function sourceOfChatbot(question: string, view: View, sources: Map<string, Source>, cites: string[]) {
  const amount = question.match(/€\s*(\d{1,3}(?:[,.]\d{3})?)|(\d{3,5})/);
  if (!amount) return { answer: "I couldn't identify the amount in your question.", citations: [] };
  const target = Number((amount[1] ?? amount[2] ?? "").replace(/[,.]/g, ""));

  const candidates = [view.upcoming["tenancy.rent.next"], view.current["tenancy.rent.next"], view.current["tenancy.rent.base"]]
    .filter(Boolean)
    .flatMap((v) => (v!.kind === "single" ? [v!.fact] : v!.facts));
  const match = candidates.find((f) => Number(f.value) === target);
  if (!match) return { answer: `No source in the current document asserts €${target} for rent.`, citations: [] };

  const s = sources.get(match.source);
  if (s) cites.push(s.title);
  return {
    answer: `${fmtEur(match.value)} appears in ${s?.title ?? match.source} (source reliability ${s?.source_prior.toFixed(2) ?? "?"}, extractor confidence ${match.confidence.toFixed(2)}).`,
    citations: [...new Set(cites)],
  };
}

function leaseEndChatbot(view: View, sources: Map<string, Source>, cites: string[]) {
  const v = view.current["tenancy.end"];
  if (v?.kind !== "single") return { answer: "The lease end date isn't specified in the current view.", citations: [] };
  const f = v.fact;
  const s = sources.get(f.source);
  if (s) cites.push(s.title);
  return {
    answer: `The lease runs until ${formatDate(String(f.value))}, per ${s?.title ?? f.source}.`,
    citations: [...new Set(cites)],
  };
}

function inspectionChatbot(view: View, sources: Map<string, Source>, cites: string[]) {
  const v = view.current["condition.last_inspection"];
  if (v?.kind !== "single") return { answer: "No inspection record in the current view.", citations: [] };
  const f = v.fact;
  const s = sources.get(f.source);
  if (s) cites.push(s.title);
  return {
    answer: `The last inspection was on ${formatDate(String(f.value))}, noted in ${s?.title ?? f.source}.`,
    citations: [...new Set(cites)],
  };
}

function ticketsChatbot(view: View, sources: Map<string, Source>, cites: string[]) {
  const v = view.current["condition.open_tickets"];
  if (v?.kind !== "single") return { answer: "No open tickets on record.", citations: [] };
  const f = v.fact;
  const s = sources.get(f.source);
  if (s) cites.push(s.title);
  const n = Number(f.value);
  return {
    answer: `${n === 0 ? "No" : n} open ticket${n === 1 ? "" : "s"} at the moment, tracked in ${s?.title ?? f.source}.`,
    citations: [...new Set(cites)],
  };
}

function unitsChatbot(view: View, sources: Map<string, Source>, cites: string[]) {
  const v = view.current["identity.units"];
  if (v?.kind !== "single") return { answer: "Unit count isn't in the current view.", citations: [] };
  const f = v.fact;
  const s = sources.get(f.source);
  if (s) cites.push(s.title);
  return {
    answer: `The building has ${f.value} units, per the ${s?.title ?? f.source}.`,
    citations: [...new Set(cites)],
  };
}

function capsChatbot(view: View, sources: Map<string, Source>, cites: string[], ablate: Ablation) {
  const v = view.upcoming["tenancy.rent.next"] ?? view.current["tenancy.rent.next"];
  if (!v) return { answer: "No rent-cap information in the current view.", citations: [] };
  if (v.kind === "single") {
    const f = v.fact;
    const s = sources.get(f.source);
    if (s) cites.push(s.title);
    return {
      answer: `The ${ablate === "conflict" ? "(silently-picked) " : ""}rent in the current view is ${fmtEur(f.value)}, per ${s?.title ?? f.source}.`,
      citations: [...new Set(cites)],
    };
  }
  // conflict — find the cap (lower) value
  const capFact = [...v.facts].sort((a, b) => Number(a.value) - Number(b.value))[0];
  const s = sources.get(capFact.source);
  if (s) cites.push(s.title);
  return {
    answer: `The cap is ${fmtEur(capFact.value)}, asserted by ${s?.title ?? capFact.source} (source reliability ${s?.source_prior.toFixed(2) ?? "?"}). This typically derives from statutory limits.`,
    citations: [...new Set(cites)],
  };
}

function fallbackChatbot(view: View) {
  const preds = Object.keys(view.current).slice(0, 6);
  return {
    answer: `I don't have a strong match for that question. In the current Context.md I can answer about: ${preds.join(", ")}. Try asking about rent, tenant, owner, lease terms, tickets, or inspections.`,
    citations: [],
  };
}

/* ----------------------------------------------------------------------------
 * Drafter composer — formal German email
 * -------------------------------------------------------------------------- */

function draftEmail(
  view: View,
  sources: Map<string, Source>,
  cites: string[],
  ablate: Ablation,
): { answer: string; citations: string[] } {
  const cur = view.current["tenancy.rent.base"];
  const tenant = view.current["tenancy.tenant"];
  const tenantName =
    tenant?.kind === "single" ? String(tenant.fact.value) : "Tenant";
  const currentRent = cur?.kind === "single" ? Number(cur.fact.value) : null;
  if (cur?.kind === "single") {
    const s = sources.get(cur.fact.source);
    if (s) cites.push(s.title);
  }

  const salutation = `Dear ${honorific(tenantName)} ${surnameOnly(tenantName)},`;
  const signoff = `Kind regards,\nMüller Immobilien GmbH`;

  const next = view.upcoming["tenancy.rent.next"] ?? view.current["tenancy.rent.next"];

  // No change announced
  if (!next) {
    return {
      answer:
        `${salutation}\n\n` +
        `This is a friendly reminder that your June rent of ${fmtEurEn(currentRent ?? 0)} is due on June 1st. ` +
        `Please transfer the amount to the usual account at your earliest convenience.\n\n` +
        `${signoff}`,
      citations: [...new Set(cites)],
    };
  }

  // Single announced change
  if (next.kind === "single") {
    const f = next.fact;
    const s = sources.get(f.source);
    if (s) cites.push(s.title);
    const when = f.valid_from ? formatDate(String(f.valid_from)) : "June 1st";
    return {
      answer:
        `${salutation}\n\n` +
        `A quick reminder about June rent. Per ${s?.title ?? "the current agreement"}, ` +
        `the amount is ${fmtEurEn(f.value)}, effective ${when}.` +
        `${ablate === "conflict" ? " (Note: conflict detection is disabled in this configuration.)" : ""}\n\n` +
        `${signoff}`,
      citations: [...new Set(cites)],
    };
  }

  // Conflict — compose a careful email that names the dispute
  const top = next.posterior.entries[0];
  const topFact = next.facts.find((x) => String(x.value) === top.value) ?? next.facts[0];
  const otherFact = next.facts.find((x) => String(x.value) !== top.value);
  const topSrc = sources.get(topFact.source);
  if (topSrc) cites.push(topSrc.title);

  if (!otherFact) {
    // All contested facts collapsed to one value — write a plain reminder
    return {
      answer:
        `${salutation}\n\n` +
        `A reminder that the June rent of ${fmtEurEn(topFact.value)} is due on June 1st, ` +
        `per ${topSrc?.title ?? "the most recent notice"}.\n\n` +
        `${signoff}`,
      citations: [...new Set(cites)],
    };
  }

  const otherSrc = sources.get(otherFact.source);
  if (otherSrc) cites.push(otherSrc.title);

  return {
    answer:
      `${salutation}\n\n` +
      `I want to flag an open item regarding the June rent. ` +
      `The amount announced in ${otherSrc?.title ?? "a recent notice"} was ${fmtEurEn(otherFact.value)}, ` +
      `however our ${topSrc?.title ?? "legal review"} notes that the enforceable amount is capped at ${fmtEurEn(topFact.value)} ` +
      `under §Mietpreisbremse. We will treat ${fmtEurEn(topFact.value)} as the operative figure until this is resolved with the landlord.\n\n` +
      `Please let me know if you have any questions.\n\n` +
      `${signoff}`,
    citations: [...new Set(cites)],
  };
}

function fmtEurEn(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? `€${n.toLocaleString("en-US")}` : String(v);
}

function honorific(fullName: string): string {
  const first = (fullName.trim().split(/\s+/)[0] ?? "").toLowerCase();
  const looksFemale = /(a|e|i)$/.test(first) && !/us$|er$/.test(first);
  return looksFemale ? "Ms." : "Mr.";
}

/* ----------------------------------------------------------------------------
 * Plain composer — canonical form for benchmarks and programmatic callers.
 *
 * Uses:
 *   - ISO dates ("2027-02-28", not "February 28, 2027")
 *   - Plain numbers ("1400" rather than "€1.400" with locale thousands-sep)
 *   - The citations still appear but in bare-title form
 *
 * Chatbot/drafter personas get natural prose elsewhere. This one is precise.
 * -------------------------------------------------------------------------- */

function plainAnswerCanonical(
  question: string,
  intent: Intent,
  view: View,
  sources: Map<string, Source>,
  cites: string[],
  ablate: Ablation,
): { answer: string; citations: string[] } {
  const citeOf = (srcId: string) => {
    const s = sources.get(srcId);
    if (s) cites.push(s.title);
    return s?.title ?? srcId;
  };

  switch (intent) {
    case "rent-status":
    case "rent-next": {
      const v = view.upcoming["tenancy.rent.next"] ?? view.current["tenancy.rent.next"];
      if (!v) {
        const cur = view.current["tenancy.rent.base"];
        if (cur?.kind === "single") {
          return {
            answer: `${plainNumber(cur.fact.value)} EUR/month (${citeOf(cur.fact.source)}).`,
            citations: [...new Set(cites)],
          };
        }
        return { answer: "No rent information available.", citations: [] };
      }
      if (v.kind === "single") {
        return {
          answer: `${plainNumber(v.fact.value)} EUR/month (${citeOf(v.fact.source)}).`,
          citations: [...new Set(cites)],
        };
      }
      // conflict
      const top = v.posterior.entries[0];
      const topFact = v.facts.find((x) => String(x.value) === top.value) ?? v.facts[0];
      const otherFact = v.facts.find((x) => String(x.value) !== top.value);
      const topTitle = citeOf(topFact.source);
      if (!otherFact) {
        // Collapsed — render as single
        return {
          answer: `${plainNumber(topFact.value)} EUR/month (${topTitle}).`,
          citations: [...new Set(cites)],
        };
      }
      const otherTitle = citeOf(otherFact.source);
      const isLandlordEmail = /email|landlord/i.test(otherTitle);
      return {
        answer:
          `Contested: ${otherTitle}${isLandlordEmail ? " (landlord)" : ""} proposes ${plainNumber(otherFact.value)} EUR, ` +
          `${topTitle} asserts ${plainNumber(topFact.value)} EUR. ` +
          `Posterior: P(${plainNumber(topFact.value)})=${top.probability.toFixed(2)}, ` +
          `P(${plainNumber(otherFact.value)})=${v.posterior.entries[1]?.probability.toFixed(2) ?? "0.00"} ` +
          `(Dawid-Skene 1979). Most likely: ${plainNumber(topFact.value)} EUR.`,
        citations: [...new Set(cites)],
      };
    }
    case "rent-current": {
      const v = view.current["tenancy.rent.base"];
      if (v?.kind !== "single") return { answer: "No current rent on record.", citations: [] };
      return {
        answer: `${plainNumber(v.fact.value)} EUR/month since ${v.fact.valid_from ?? "unknown"} (${citeOf(v.fact.source)}).`,
        citations: [...new Set(cites)],
      };
    }
    case "tenant": {
      const v = view.current["tenancy.tenant"];
      if (v?.kind !== "single") return { answer: "No tenant on record.", citations: [] };
      const start = view.current["tenancy.start"];
      const since = start?.kind === "single" ? ` since ${start.fact.value}` : "";
      return {
        answer: `Tenant: ${v.fact.value}${since} (${citeOf(v.fact.source)}).`,
        citations: [...new Set(cites)],
      };
    }
    case "owner": {
      const v = view.current["identity.owner"];
      if (v?.kind !== "single") return { answer: "No owner on record.", citations: [] };
      return {
        answer: `Owner: ${v.fact.value} (${citeOf(v.fact.source)}).`,
        citations: [...new Set(cites)],
      };
    }
    case "units": {
      const v = view.current["identity.units"];
      if (v?.kind !== "single") return { answer: "Unknown.", citations: [] };
      return {
        answer: `${v.fact.value} units (${citeOf(v.fact.source)}).`,
        citations: [...new Set(cites)],
      };
    }
    case "lease-end": {
      const v = view.current["tenancy.end"];
      if (v?.kind !== "single") return { answer: "No lease-end date on record.", citations: [] };
      return {
        answer: `Lease end: ${v.fact.value} (${citeOf(v.fact.source)}).`,
        citations: [...new Set(cites)],
      };
    }
    case "inspection": {
      const v = view.current["condition.last_inspection"];
      if (v?.kind !== "single") return { answer: "No inspection on record.", citations: [] };
      return {
        answer: `Last inspection: ${v.fact.value} (${citeOf(v.fact.source)}).`,
        citations: [...new Set(cites)],
      };
    }
    case "tickets": {
      const v = view.current["condition.open_tickets"];
      if (v?.kind !== "single") return { answer: "0 open tickets.", citations: [] };
      return {
        answer: `${v.fact.value} open ticket${Number(v.fact.value) === 1 ? "" : "s"} (${citeOf(v.fact.source)}).`,
        citations: [...new Set(cites)],
      };
    }
    case "posterior": {
      const v = view.upcoming["tenancy.rent.next"] ?? view.current["tenancy.rent.next"];
      if (v?.kind !== "conflict") {
        return { answer: "No posterior — no live conflict.", citations: [] };
      }
      const entries = v.posterior.entries
        .map((e) => `P(${plainNumber(e.value)})=${e.probability.toFixed(2)}`)
        .join(", ");
      for (const f of v.facts) citeOf(f.source);
      return {
        answer: `Posterior on rent.next: ${entries} via Dawid-Skene (1979).`,
        citations: [...new Set(cites)],
      };
    }
    case "source-of": {
      const amount = question.match(/€\s*(\d{1,3}(?:[,.]\d{3})?)|\b(\d{3,5})\b/);
      if (!amount) return { answer: "No amount recognized.", citations: [] };
      const target = Number((amount[1] ?? amount[2] ?? "").replace(/[,.]/g, ""));
      const candidates = [view.upcoming["tenancy.rent.next"], view.current["tenancy.rent.next"], view.current["tenancy.rent.base"]]
        .filter(Boolean)
        .flatMap((v) => (v!.kind === "single" ? [v!.fact] : v!.facts));
      const match = candidates.find((f) => Number(f.value) === target);
      if (!match) return { answer: `No source asserts ${target} for rent.`, citations: [] };
      const src = sources.get(match.source);
      citeOf(match.source);
      const isLandlord = /landlord|email:landlord/i.test(src?.title ?? "");
      return {
        answer: `${target} EUR is from ${src?.title ?? match.source}${isLandlord ? " (landlord)" : ""} — source_prior=${src?.source_prior.toFixed(2) ?? "?"}, confidence=${match.confidence.toFixed(2)}.`,
        citations: [...new Set(cites)],
      };
    }
    case "caps": {
      const v = view.upcoming["tenancy.rent.next"] ?? view.current["tenancy.rent.next"];
      if (v?.kind === "conflict") {
        const capFact = [...v.facts].sort((a, b) => Number(a.value) - Number(b.value))[0];
        const isLegal = /legal|memo|mietpreis/i.test(sources.get(capFact.source)?.title ?? "");
        return {
          answer: `Cap: ${plainNumber(capFact.value)} EUR per ${citeOf(capFact.source)}${isLegal ? " (mietpreisbremse applies — the landlord's proposal is not enforceable)" : ""}.`,
          citations: [...new Set(cites)],
        };
      }
      if (v?.kind === "single") {
        return {
          answer: `Current rent.next: ${plainNumber(v.fact.value)} EUR (${citeOf(v.fact.source)})${ablate === "conflict" ? " — note: conflict detection disabled in this ablation" : ""}.`,
          citations: [...new Set(cites)],
        };
      }
      return { answer: "No cap information available.", citations: [] };
    }
    default:
      return fallbackPlain(view);
  }
}

function fallbackPlain(view: View): { answer: string; citations: string[] } {
  const preds = Object.keys(view.current).slice(0, 6);
  return {
    answer: `No strong match. Active predicates: ${preds.join(", ")}.`,
    citations: [],
  };
}

function plainNumber(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? String(n) : String(v);
}

/* ----------------------------------------------------------------------------
 * Tiny helpers
 * -------------------------------------------------------------------------- */

function fmtEur(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? `€${n.toLocaleString("en-US")}` : String(v);
}

function formatDate(iso: string): string {
  if (!iso) return iso;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function surnameOnly(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

