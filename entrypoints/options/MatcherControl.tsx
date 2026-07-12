import { useEffect, useState } from "preact/hooks";
import type { Matcher, MatchMode } from "../../src/types";

export const MODE_OPTIONS: { mode: MatchMode; label: string }[] = [
  { mode: "contains", label: "Contains" },
  { mode: "exact", label: "Exact" },
  { mode: "starts", label: "Starts with" },
  { mode: "ends", label: "Ends with" },
  { mode: "domain", label: "Domain" },
  { mode: "regex", label: "Custom regex" },
];

const HINTS: Record<MatchMode, string> = {
  contains: "e.g. matches any URL containing api.example.com",
  exact: "e.g. matches only https://api.example.com/v1",
  starts: "e.g. matches URLs starting with https://api.",
  ends: "e.g. matches URLs ending with /graphql",
  domain: "matches host and subdomains",
  regex: "e.g. ^https://.*\\.dev/",
};

export function regexError(mode: MatchMode, value: string): string | null {
  if (mode !== "regex" || value === "") return null;
  try {
    new RegExp(value);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// A regex can be valid JavaScript yet unsupported by DNR's RE2 engine (lookahead,
// backreferences) — those pass regexError() but make updateDynamicRules reject the
// whole batch. Ask Chrome directly so the editor catches them before they ship (#4).
function useRe2Error(mode: MatchMode, value: string, jsInvalid: boolean): string | null {
  const [re2Error, setRe2Error] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "regex" || value === "" || jsInvalid
      || typeof chrome === "undefined" || !chrome.declarativeNetRequest?.isRegexSupported) {
      setRe2Error(null);
      return;
    }
    let cancelled = false;
    chrome.declarativeNetRequest
      .isRegexSupported({ regex: value })
      .then((r) => {
        if (cancelled) return;
        setRe2Error(r.isSupported ? null : re2Reason(r.reason));
      })
      .catch(() => {}); // isRegexSupported unavailable (e.g. tests) — fall back to JS check only
    return () => {
      cancelled = true;
    };
  }, [mode, value, jsInvalid]);
  return re2Error;
}

function re2Reason(reason?: chrome.declarativeNetRequest.UnsupportedRegexReason): string {
  if (reason === "syntaxError") return "not valid for Chrome's regex engine (RE2)";
  if (reason === "memoryLimitExceeded") return "too large for Chrome's regex engine";
  return "not supported by Chrome's regex engine (RE2)";
}

export function MatcherControl({
  matcher,
  onChange,
  compact,
}: {
  matcher: Matcher;
  onChange: (next: Matcher) => void;
  compact?: boolean;
}) {
  const jsError = regexError(matcher.mode, matcher.value);
  const re2Error = useRe2Error(matcher.mode, matcher.value, jsError !== null);
  const error = jsError ?? re2Error;

  return (
    <div>
      <div class="matcher-row">
        <select
          class={`select ${compact ? "select-sm" : ""} matcher-mode`}
          value={matcher.mode}
          onChange={(e) => onChange({ ...matcher, mode: (e.target as HTMLSelectElement).value as MatchMode })}
        >
          {MODE_OPTIONS.map((o) => (
            <option value={o.mode} key={o.mode}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          class={`input input-mono matcher-value ${error ? "input-danger" : ""}`}
          type="text"
          value={matcher.value}
          onInput={(e) => onChange({ ...matcher, value: (e.target as HTMLInputElement).value })}
          placeholder="value to match"
        />
      </div>
      {error ? (
        <div class="helper helper-danger">⚠ Invalid regular expression: {error}</div>
      ) : (
        <div class="helper helper-mono">{HINTS[matcher.mode]}</div>
      )}
    </div>
  );
}
