# All-URLs default matcher + header-name field sizing — Design

**Date:** 2026-08-29
**Issues closed:** #38 (first profile should default to matching all URLs, while encouraging a URL matcher), #37 (header name input is too small and can't be expanded)
**Intensity:** 7/10
**ADR:** [0008 — All-URLs matcher encoded as regex `.*`, not a new MatchMode](../docs/adr/0008-all-urls-as-regex-dot-star.md)

## Goal

A newly created profile works immediately with no configuration, while the
editor tells the user — in proportion to the actual risk — that their headers
are going to every URL. Separately, the header-name field stops truncating long
header names.

## Background

`newProfile()` (`entrypoints/options/main.tsx:27`) creates
`matcher: { mode: "contains", value: "" }`. `compileRules`
(`src/lib/compile.ts`) skips every rule whose matcher has an empty value,
because an empty `urlFilter`/`regexFilter`/`requestDomains` entry makes Chrome
reject the whole `updateDynamicRules` batch. Net effect for a first-time user:
add a profile, add a header, nothing happens.

The header-name input is `width: 132px; flex: none`
(`entrypoints/options/style.css:538`), so `Access-Control-Allow-Credentials`
and friends are truncated with no way to widen the field. `.value-input` next to
it already flexes — the name field is the odd one out.

## Architecture

### All-URLs is an encoding, not a mode

The `MatchMode` union is **unchanged**. An all-URLs matcher is the existing
Custom regex mode carrying the exact value `.*` — the same shape the ModHeader
converter has emitted for "no URL filter" since it shipped
(`src/lib/modheader.ts:71`). See ADR-0008 for why a seventh mode was rejected:
`isMatchMode` is a hard allowlist, so an old client (ADR-0006 mixed-version
coexistence, ADR-0002 share format) would reject an `"all"` matcher and the
profile would silently match nothing on that machine.

The editor still presents All URLs as a first-class, nameable choice. The mode
select gains a UI-only sentinel option whose value is `"all"`; the select's
displayed value is `isAllUrls(matcher) ? "all" : matcher.mode`.

**Accepted consequence:** the select's value is no longer a pure function of
`matcher.mode`. A user who picks Custom regex and types `.*` sees the control
flip to All URLs. That label is telling the truth, and UI-only intent state
would be right until the page reloads and wrong afterwards.

### Compiled form

`matcherToDnrCondition` special-cases an all-URLs matcher to
`{ urlFilter: "*" }` instead of `{ regexFilter: ".*" }`. Every new profile now
runs against every request, so the default path must be a plain filter match
rather than an RE2 evaluation. Already-imported ModHeader profiles pick up the
cheaper form too; `diffRules` treats that as an ordinary content change.

`evaluateMatcher` needs no change — `new RegExp(".*").test(url)` is
unconditionally true, so the live log and badge already agree with the compiled
rule.

### The nudge

Rendered by `MatcherControl` in the same `.helper` slot that currently holds the
per-mode hint, so it replaces the hint exactly when the matcher is all-URLs.

Two states, one predicate:

- **Calm** — shown whenever the profile matcher is all-URLs, full stop.
  Copy: `Applies to every URL. Set a URL matcher to limit which sites this profile touches.`
- **Escalated** — the conditional layer on top, styled as a warning.
  Copy: `⚠ These headers are sent to every URL, including sites you don't control. Set a URL matcher to scope this profile.`

Escalation fires when the profile is enabled and at least one enabled Set/Append
rule with a non-empty trimmed name has an *effective* matcher (its own override,
else the profile's) that is all-URLs. That mirrors what `compileRules` would
actually emit — a blank-name or disabled rule sends nothing, and a rule with a
narrow override does not use the profile matcher.

The profile-enabled half of that gate lives in the callers, not in
`ruleSendsHeadersEverywhere`, which is handed a rule and a matcher and cannot see
the profile: `sendsHeadersEverywhere` applies it for the profile-level nudge, and
`HeaderRow` ANDs in the profile's enabled flag (a `profileEnabled` prop) before
rendering the per-rule note or escalating the override panel — so a disabled
profile, which compiles to nothing, stays calm at both levels.

The master switch does **not** suppress escalation: it is a temporary global
pause, and the profile is still misconfigured.

The nudge is not dismissible — the condition *is* the warning, and it disappears
the moment the user scopes the matcher.

### Components

| File | Responsibility |
|---|---|
| `src/lib/matcher.ts` | `ALL_URLS_MATCHER`, `isAllUrls`, all-URLs branch in `matcherToDnrCondition`, `ruleSendsHeadersEverywhere` + the `sendsHeadersEverywhere` predicate built on it |
| `entrypoints/options/MatcherControl.tsx` | All URLs option in the select, hides the value input (unless it holds focus or the user just picked Custom regex), renders the calm/escalated nudge |
| `entrypoints/options/HeaderRow.tsx` | Takes the profile matcher and enabled flag; passes `escalated` to the override's `MatcherControl` and shows a persistent note when the rule's own override is all-URLs |
| `entrypoints/options/main.tsx` | `newProfile()` seeds `ALL_URLS_MATCHER`; passes `escalated` to the profile matcher control and `profileMatcher` to each `HeaderRow` |
| `entrypoints/options/style.css` | `.helper-warn` amber state; `.header-name-input` / `.col-name` flex sizing |
| `README.md` | "one of six modes" → All URLs mention; profile-creation sentence |
| `CONTEXT.md` | **All-URLs matcher** glossary entry (already added) |

### Interfaces

```ts
// src/lib/matcher.ts
export const ALL_URLS_MATCHER: Readonly<Matcher>; // frozen { mode: "regex", value: ".*" }
export function isAllUrls(m: Matcher): boolean;
export function ruleSendsHeadersEverywhere(r: HeaderRule, profileMatcher: Matcher | undefined): boolean;
export function sendsHeadersEverywhere(p: Profile): boolean;
```

```tsx
// entrypoints/options/MatcherControl.tsx — one added optional prop
{ matcher, onChange, compact?, escalated? }
```

### Data flow

1. User clicks **＋ New profile** → `newProfile()` returns a profile with a copy
   of `ALL_URLS_MATCHER`.
2. `configStore.setValue` persists it; the background worker recompiles.
3. `compileRules` → `matcherToDnrCondition` → `{ urlFilter: "*" }` for every
   enabled, named rule in the profile.
4. The editor renders `MatcherControl` with `escalated={sendsHeadersEverywhere(selected)}`;
   the select shows **All URLs**, the value input is hidden, and the helper slot
   carries the calm or escalated copy.

### Mode switching

- Selecting **All URLs** writes `{ ...ALL_URLS_MATCHER }`.
- Switching *from* All URLs to any other mode resets the value to `""`. Carrying
  `.*` into Contains mode would produce a matcher that looks scoped but matches
  only URLs literally containing `.*`. **Custom regex is the exception:** `.*` is
  a legitimate regex, so it carries over as editable seed text and the value
  input is revealed for editing.
- The value input stays mounted while it holds focus even once the matcher reads
  as all-URLs, so a `.*`-prefixed regex can be typed without the field being
  unmounted mid-keystroke.
- Switching between two non-all modes keeps the value, as today.

### Rule-level overrides

The compact `MatcherControl` used for a rule override offers All URLs too — an
override that cannot express what the profile default can is an inconsistency
users will hit. The override *seed* stays `{ mode: "contains", value: "" }`;
changing it is not part of either issue.

### Header-name field (#37)

`.header-name-input` drops `flex: none` and becomes `flex: 1 1 132px` with
`min-width: 132px`, so 132px stays the floor and today's narrow-width layout is
unchanged. `.col-name` in `.rules-col-header` gets the identical flex rule so the
column heading keeps aligning with the row.

**Stated assumption:** a `max-width: 320px` cap is applied so the name field
cannot grow to crowd out the value field on a wide window. This was not
explicitly specified; it is the one judgement call in #37 and is called out here
for review.

## Error handling

- No new failure modes. `hasEmptyValue` in `compileRules` is unaffected — `.*`
  is non-empty.
- `decodeShare` validation is unchanged: `regex` is already an accepted mode, so
  an all-URLs profile round-trips through the existing `isMatcher` guard.
- The `regexError` / RE2 checks in `MatcherControl` are skipped while All URLs is
  selected because the value input is hidden and `.*` is trivially valid; the
  existing code paths still run for a hand-typed regex.

## Testing strategy

- `src/lib/matcher.test.ts` — `isAllUrls` true/false cases; `matcherToDnrCondition`
  returns `{ urlFilter: "*" }` with no `regexFilter`; `sendsHeadersEverywhere`
  across disabled profile, remove-only rules, blank-name rule, narrow override,
  all-URLs override.
- `src/lib/compile.test.ts` — a profile on the all-URLs matcher compiles a live
  rule (regression against the "new profile does nothing" bug).
- `entrypoints/options/main.test.tsx` — **＋ New profile** produces a profile
  whose matcher control reads **All URLs** and shows the calm nudge.
- `src/lib/share.test.ts` — an all-URLs profile survives encode → decode
  unchanged. This pins the entire safety argument for the ADR-0008 encoding.

- `entrypoints/options/MatcherControl.test.tsx` — mode switching (All URLs writes
  `.*`; leaving it clears the value except for Custom regex), the value input
  surviving `.*` being typed into it, and the calm/escalated nudge rendering.
- `entrypoints/options/HeaderRow.test.tsx` — the per-rule all-URLs override note
  and the escalated override nudge.

## Out of scope

- **No migration of existing empty-value matchers.** They match nothing today;
  activating them on update would send headers the user never consented to send.
- **No header-name allowlist / `Authorization` guard.** Blocking a legitimate
  local-dev-proxy workflow is worse than the generic nudge. File separately if
  wanted.
- **No popup or side-panel nudge.** Those surfaces toggle and observe; a warning
  there has nothing actionable next to it.
- **No badge / live-log special-casing** for all-URLs profiles. They genuinely do
  match every tab; making the badge lie would re-create #38's problem inverted.
- **No store-listing update.** README only.
- **Pre-existing README staleness flagged, not fixed:** README's Concepts section
  says a rule is "a Set or Remove operation", which predates the Append op
  (ADR-0007). Unrelated to both issues — left alone deliberately.
