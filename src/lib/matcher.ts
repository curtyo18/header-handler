import type { Matcher } from "../types";

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
  }
}

export function evaluateMatcher(m: Matcher, url: string): boolean {
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
  }
}
