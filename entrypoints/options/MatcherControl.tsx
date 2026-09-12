import { useEffect, useState } from "preact/hooks";
import type { Matcher, MatchMode } from "../../src/types";
import { ALL_URLS_MATCHER, isAllUrls } from "../../src/lib/matcher";

export const MODE_OPTIONS: { mode: MatchMode; label: string }[] = [
  { mode: "contains", label: "Contains" },
  { mode: "exact", label: "Exact" },
  { mode: "starts", label: "Starts with" },
  { mode: "ends", label: "Ends with" },
  { mode: "domain", label: "Domain" },
  { mode: "regex", label: "Custom regex" },
];

// A UI-only sentinel. All URLs is not a MatchMode — it's the regex ".*" shape
// (ADR-0008) — so the select's value is isAllUrls(m) ? ALL_URLS_VALUE : m.mode
// rather than m.mode alone. Consequence: picking Custom regex and typing ".*"
// flips the control to All URLs. That label is accurate, and UI-only intent
// state would be right until the page reloads and wrong afterwards.
const ALL_URLS_VALUE = "all";

const ALL_URLS_CALM =
  "Applies to every URL. Set a URL matcher to limit which sites this profile touches.";
const ALL_URLS_ESCALATED =
  "⚠ These headers are sent to every URL, including sites you don't control. Set a URL matcher to scope this profile.";

const HINTS: Record<MatchMode, string> = {
  contains: "e.g. matches any URL containing api.example.com",
  exact: "e.g. matches only https://api.example.com/v1",
  starts: "e.g. matches URLs starting with https://api.",
  ends: "e.g. matches URLs ending with /graphql",
  domain: "e.g. example.com matches example.com and api.example.com",
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

// This field takes a bare pattern, not a JS regex literal. The literal form is
// the one mistake that survives both checks above: "/api/g" is the perfectly
// valid pattern \/api\/g, so regexError() and isRegexSupported() both pass it and
// the rule quietly matches the literal text "/api/g" instead of "/api" (#41).
const REGEX_LITERAL = /^\/(.+)\/([dgimsuvy]*)$/;

// Trailing backslashes in the body decide whether the closing "/" was a
// delimiter or an escaped slash: "/log\/" is the bare pattern for URLs
// containing "log/", not a literal wrapping the body "log\".
function closingSlashIsEscaped(body: string): boolean {
  const run = /\\*$/.exec(body)![0].length;
  return run % 2 === 1;
}

// JS rejects a repeated flag, so a run like the "gg" of "/api/gg" is path text
// that happens to be spelled in flag letters, not a flags clause — which makes
// the whole value an ordinary bare pattern with nothing to warn about.
function hasRepeatedFlag(flags: string): boolean {
  return new Set(flags).size !== flags.length;
}

export function regexLiteralWarning(
  mode: MatchMode,
  value: string,
): { suggestion: string; hasFlags: boolean } | null {
  // Trimmed because the literal form usually arrives pasted, and " /api/g " is
  // the same mistake with the same fix.
  const trimmed = mode === "regex" ? value.trim() : "";
  if (trimmed === "") return null;
  const m = REGEX_LITERAL.exec(trimmed);
  if (!m || closingSlashIsEscaped(m[1]) || hasRepeatedFlag(m[2])) return null;
  // Deliberately one message, offered rather than asserted, whether or not a
  // flags clause is present: "/users/id" is a plausible path pattern that parses
  // as body "users" plus flags "id", and no test tells it apart from "/api/gi".
  // Telling that user they made a mistake would be worse than the silent
  // mismatch #41 is about, so the copy only points out what the outer slashes
  // do — true either way — and lets them decide. Flags are dropped from the
  // suggestion because DNR's regexFilter has no flags field to carry them.
  // hasFlags is the only positive evidence of a literal, so it gates the field
  // tint: "/api/" is the ordinary way to write a path-segment pattern and every
  // one of those is delimiter-shaped, so an amber border there would sit on
  // correct input permanently. The helper line still offers the reading.
  return { suggestion: m[1], hasFlags: m[2] !== "" };
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
  escalated,
}: {
  matcher: Matcher;
  onChange: (next: Matcher) => void;
  compact?: boolean;
  escalated?: boolean;
}) {
  const allUrls = isAllUrls(matcher);
  // The value input is normally hidden for an all-URLs matcher, but two cases
  // need it on screen anyway, or ".*" becomes a dead end: while it holds focus
  // (typing ".*" flips allUrls true mid-keystroke — the select label following
  // is ADR-0008 behaviour, unmounting the field under the caret is not, and it
  // made a ".*"-prefixed regex untypable), and right after the user explicitly
  // picks Custom regex, which is a request to edit the ".*" carried over.
  const [valueOpen, setValueOpen] = useState(false);
  const jsError = regexError(matcher.mode, matcher.value);
  const re2Error = useRe2Error(matcher.mode, matcher.value, jsError !== null);
  const error = jsError ?? re2Error;
  // Only when the pattern compiles: a broken regex has a real error to show, and
  // stacking a shape hint on top of it would bury the thing that blocks the rule.
  const warning = error ? null : regexLiteralWarning(matcher.mode, matcher.value);

  function selectMode(next: string) {
    if (next === ALL_URLS_VALUE) {
      setValueOpen(false);
      onChange({ ...ALL_URLS_MATCHER });
      return;
    }
    // Leaving All URLs clears the value: carrying ".*" into e.g. Contains would
    // look scoped but match only URLs literally containing ".*". Custom regex is
    // the exception — there ".*" is valid, so it carries over as editable seed
    // text rather than dropping the user into an empty field.
    const keepValue = !allUrls || next === "regex";
    setValueOpen(allUrls && next === "regex");
    onChange({ mode: next as MatchMode, value: keepValue ? matcher.value : "" });
  }

  return (
    <div>
      <div class="matcher-row">
        <select
          class={`select ${compact ? "select-sm" : ""} matcher-mode`}
          value={allUrls ? ALL_URLS_VALUE : matcher.mode}
          onChange={(e) => selectMode((e.target as HTMLSelectElement).value)}
        >
          <option value={ALL_URLS_VALUE} key={ALL_URLS_VALUE}>
            All URLs
          </option>
          {MODE_OPTIONS.map((o) => (
            <option value={o.mode} key={o.mode}>
              {o.label}
            </option>
          ))}
        </select>
        {(!allUrls || valueOpen) && (
          <input
            class={`input input-mono matcher-value ${error ? "input-danger" : warning?.hasFlags ? "input-warn" : ""}`}
            type="text"
            value={matcher.value}
            onInput={(e) => onChange({ ...matcher, value: (e.target as HTMLInputElement).value })}
            onFocus={() => setValueOpen(true)}
            onBlur={() => setValueOpen(false)}
            placeholder="value to match"
          />
        )}
      </div>
      {allUrls ? (
        <div class={`helper ${escalated ? "helper-warn" : ""}`} role="status">
          {escalated ? ALL_URLS_ESCALATED : ALL_URLS_CALM}
        </div>
      ) : error ? (
        <div class="helper helper-danger">⚠ Invalid regular expression: {error}</div>
      ) : warning ? (
        <div class="helper helper-warn" role="status">
          ⚠ Leading and trailing / are matched literally. If you meant the pattern between them,
          enter <code class="helper-mono">{warning.suggestion}</code>
        </div>
      ) : (
        <div class="helper helper-mono">{HINTS[matcher.mode]}</div>
      )}
    </div>
  );
}
