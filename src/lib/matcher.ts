import type { Matcher, MatchMode } from "../types";

export const MATCH_MODES: MatchMode[] = ["contains", "exact", "starts", "ends", "domain", "regex"];

// Runtime guard for values that reach us untyped (decoded share strings): an
// unrecognized mode must never fall through to a filter-less DNR condition,
// which DNR treats as match-all (see decodeShare / compileRules).
export function isMatchMode(x: unknown): x is MatchMode {
  return typeof x === "string" && (MATCH_MODES as string[]).includes(x);
}

export function escapeUrlFilter(v: string): string {
  return v.replace(/[|*^]/g, (c) => "\\" + c);
}

export function matcherToDnrCondition(m: Matcher): chrome.declarativeNetRequest.RuleCondition {
  switch (m.mode) {
    case "contains": return { urlFilter: escapeUrlFilter(m.value) };
    case "starts":   return { urlFilter: "|" + escapeUrlFilter(m.value) };
    case "ends":     return { urlFilter: escapeUrlFilter(m.value) + "|" };
    case "exact":    return { urlFilter: "|" + escapeUrlFilter(m.value) + "|" };
    case "domain":   return { requestDomains: [m.value] };
    case "regex":    return { regexFilter: m.value };
    // An unknown mode has no valid condition; refuse rather than emit a
    // filter-less (match-all) one. compileRules pre-checks isMatchMode so this
    // never drops a live batch — it's the last-resort guard.
    default:         throw new Error(`Unknown matcher mode: ${(m as Matcher).mode}`);
  }
}

export function evaluateMatcher(m: Matcher, url: string): boolean {
  // An empty matcher value can't compile to a valid DNR condition (compileRules skips
  // it), so it must never match here either — otherwise contains/starts/ends/regex
  // degrade to "match everything" and the live log lies.
  if (m.mode !== "domain" && m.value.trim() === "") return false;
  switch (m.mode) {
    case "contains": return url.includes(m.value);
    case "starts":   return url.startsWith(m.value);
    case "ends":     return url.endsWith(m.value);
    case "exact":    return url === m.value;
    case "domain": {
      try {
        const host = new URL(url).hostname;
        return host === m.value || host.endsWith("." + m.value);
      } catch { return false; }
    }
    case "regex": {
      try { return new RegExp(m.value).test(url); } catch { return false; }
    }
    default: return false; // unknown mode never matches (mirrors compileRules skipping it)
  }
}
