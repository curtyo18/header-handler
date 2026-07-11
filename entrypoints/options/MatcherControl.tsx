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

export function MatcherControl({
  matcher,
  onChange,
  compact,
}: {
  matcher: Matcher;
  onChange: (next: Matcher) => void;
  compact?: boolean;
}) {
  const error = regexError(matcher.mode, matcher.value);

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
