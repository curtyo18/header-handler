import type { Config, Profile, HeaderRule, Matcher } from "../types";

export interface ConvertResult {
  config: Config;
  warnings: string[];
}

// ModHeader writes full-match regexes, so a "contains X" URL filter arrives as
// ".*X.*". Chrome DNR's regexFilter is a *partial* match (as is the live-log's
// RegExp.test), so a leading/trailing ".*" is redundant — and several of them
// across an OR-alternation blow past RE2's per-regex memory budget, which Chrome
// rejects as "too large for Chrome's regex engine". Strip one redundant leading
// ".*" (with an optional preceding "^") and one trailing ".*" (with an optional
// following "$") so the compiled regex stays small while matching the same URLs.
// Internal ".*" is left intact. Never returns empty: a filter that is only a
// bounding wildcard (e.g. ".*") keeps its original value.
function stripBoundingWildcards(re: string): string {
  const stripped = re.replace(/^\^?\.\*/, "").replace(/\.\*\$?$/, "");
  return stripped === "" ? re : stripped;
}

interface MhHeader {
  name?: unknown;
  value?: unknown;
  enabled?: unknown;
  appendMode?: unknown;
}

interface MhUrlFilter {
  enabled?: unknown;
  urlRegex?: unknown;
  methods?: unknown;
}

interface MhProfile {
  title?: unknown;
  headers?: unknown;
  urlFilters?: unknown;
  excludeUrlFilters?: unknown;
  respHeaders?: unknown;
}

// Convert a parsed ModHeader v2 export into a Header Handler Config plus a list
// of human-readable warnings for every lossy mapping. Never throws on lossy
// content — only on input that is not a ModHeader export at all. Profiles are
// always imported disabled: ModHeader carries no per-profile on/off state,
// no-filter profiles become match-all, and dropped excludes broaden scope, so
// nothing should fire until the user reviews it.
export function convertModHeader(raw: unknown): ConvertResult {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { profiles?: unknown }).profiles)) {
    throw new Error("Not a ModHeader export: missing profiles array");
  }
  const mhProfiles = (raw as { profiles: unknown[] }).profiles;
  const warnings: string[] = [];

  const profiles: Profile[] = mhProfiles.map((rawProfile, i) => {
    const p = (rawProfile ?? {}) as MhProfile;
    const name = typeof p.title === "string" && p.title.trim() !== "" ? p.title : `Imported profile ${i + 1}`;

    // Matcher: OR the enabled urlFilters; fall back to match-all.
    const urlFilters: MhUrlFilter[] = Array.isArray(p.urlFilters) ? (p.urlFilters as MhUrlFilter[]) : [];
    const active = urlFilters.filter(
      (f) => f && f.enabled !== false && typeof f.urlRegex === "string" && f.urlRegex.trim() !== "",
    );
    let matcher: Matcher;
    if (active.length === 0) {
      matcher = { mode: "regex", value: ".*" };
      warnings.push(`Profile "${name}": no active URL filter → matches all URLs (imported disabled).`);
    } else if (active.length === 1) {
      matcher = { mode: "regex", value: stripBoundingWildcards(active[0].urlRegex as string) };
    } else {
      // Non-capturing groups keep each filter's precedence without the submatch
      // cost of capturing groups; stripping the bounding ".*" keeps RE2 within budget.
      matcher = {
        mode: "regex",
        value: active.map((f) => `(?:${stripBoundingWildcards(f.urlRegex as string)})`).join("|"),
      };
    }
    if (active.some((f) => Array.isArray(f.methods) && f.methods.length > 0)) {
      warnings.push(`Profile "${name}": HTTP-method filter dropped (not supported) — rule applies to all methods.`);
    }

    // Unsupported scope / response-header features → warn and drop.
    const excludes = Array.isArray(p.excludeUrlFilters) ? p.excludeUrlFilters : [];
    if (excludes.length > 0) {
      warnings.push(
        `Profile "${name}": ${excludes.length} exclude filter(s) dropped (not supported) — headers may apply to URLs you excluded.`,
      );
    }
    const respHeaders = Array.isArray(p.respHeaders) ? p.respHeaders : [];
    if (respHeaders.length > 0) {
      warnings.push(
        `Profile "${name}": ${respHeaders.length} response-header rule(s) dropped — Header Handler only edits request headers.`,
      );
    }

    // Header rules: each ModHeader request header becomes a Set rule.
    const mhHeaders: MhHeader[] = Array.isArray(p.headers) ? (p.headers as MhHeader[]) : [];
    const rules: HeaderRule[] = [];
    for (const h of mhHeaders) {
      const hname = typeof h?.name === "string" ? h.name : "";
      if (hname.trim() === "") continue;
      if (h.appendMode === true) {
        warnings.push(`Profile "${name}" header "${hname}": append became overwrite (Set).`);
      }
      rules.push({
        id: "",
        enabled: h.enabled !== false,
        op: "set",
        name: hname,
        value: String(h.value ?? ""),
      });
    }

    return { id: "", name, enabled: false, matcher, rules };
  });

  return { config: { version: 1, masterEnabled: true, profiles }, warnings };
}
