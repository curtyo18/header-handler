# ModHeader Converter + Store-Docs Correction — Design

Date: 2026-07-16
Status: accepted

Two independent deliverables from one request:

- **Part A — Store docs correction.** Chrome accepted the extension with **no**
  data-usage categories declared. The store listing pack currently insists
  disclosure is mandatory and declares three categories = Yes; correct it to
  match what shipped.
- **Part B — ModHeader converter.** A static GitHub Pages page in this repo that
  turns a ModHeader JSON export into a Header Handler **global share string**
  (`HH1g…`) the user can paste into the extension's existing Import. Starts with
  ModHeader support only.

The two parts share no code and could be split into two plans; they are kept in
one plan with clearly separated task groups because both are small.

---

## Part A — Store docs correction

### Goal

`docs/store/listing.md` should reflect the real, Chrome-approved submission: no
user-data categories declared. Remove the "disclosure is mandatory / 'does not
collect' is not an option" framing.

### Changes

1. **Remove the top warning banner** (the `⚠ Data-usage disclosure is mandatory…`
   blockquote) that argues FAQ Q3/Q14 force disclosure.
2. **Data usage → per-category table:** flip **Authentication information**,
   **Web history**, and **User activity** from **Yes** to **No**. Rationale for
   each becomes: handling is purely local, ephemeral (in-memory session storage),
   never collected or transmitted — so no category is declared, which is what was
   submitted and approved.
3. **Remove the "Why these three are declared (not optional)" explainer**
   paragraph beneath the table (it argues the opposite of the new reality).
4. **Certification checkboxes:** keep — the three "do not sell / transfer / use
   for creditworthiness" certifications are still true and still submitted.
5. **Submission checklist:** rewrite the data-usage line
   (`Data-usage declared: Authentication information + Web history + User
   activity = Yes…`) to state that no data-usage categories are declared and the
   three Limited-Use certifications are checked.

### Out of scope for Part A

- **`docs/privacy.html` is not changed.** It already describes behavior as
  local-only, never-transmitted, and Limited-Use compliant, and makes no
  dashboard category claims — it stays consistent with "no categories declared."
  The actual extension behavior (the live log reading headers locally) is
  unchanged; only the store-doc description of the *dashboard declaration* moves.
- The reviewer-notes block stays as-is (still accurate and useful).

---

## Part B — ModHeader converter

### Goal

Given a pasted ModHeader v2 export, produce a single `HH1g…` global share string
that decodes cleanly through the extension's existing `decodeShare` / Import,
plus a list of human-readable warnings for anything lossy. Runs entirely
client-side — the user's JSON never leaves their browser.

### Architecture

- **Core conversion is a pure module** in the extension source
  (`src/lib/modheader.ts`), unit-tested with vitest, so the mapping is verified
  independently of any DOM.
- **The share string is produced by the real encoder** — the page imports
  `encodeShare` from `src/lib/share.ts`. Zero format drift: the converter can
  only emit what the extension decodes (ADR-0002).
- **The page is a separate Vite build** rooted at `pages/convert/`, output to
  `docs/convert/` (committed), so GitHub Pages serves it alongside the existing
  `docs/privacy.html` with no change to how Pages is hosted (ADR-0004).

### Components / files

| File | Responsibility |
| --- | --- |
| `src/lib/modheader.ts` | `convertModHeader(raw): ConvertResult` — pure ModHeader→Config mapping + warnings. No DOM, no encoding. |
| `src/lib/modheader.test.ts` | Unit tests for every mapping rule and warning. |
| `pages/convert/index.html` | The page markup: input textarea, Convert button, output field, warnings list. |
| `pages/convert/main.ts` | DOM glue: parse JSON → `convertModHeader` → `encodeShare({kind:"g", config})` → render string + warnings + Copy. |
| `pages/convert/style.css` | Minimal dark styling (matches `privacy.html` palette). |
| `vite.pages.config.ts` | Vite config: root `pages/convert`, `base: "./"`, `build.outDir: ../../docs/convert`, `emptyOutDir: true`. |
| `package.json` | Add `"build:pages"` script; add `vite` to devDependencies (direct dep for the CLI). |
| `docs/convert/*` | Committed build output. |

### Interfaces

```ts
// src/lib/modheader.ts
import type { Config } from "../types";

export interface ConvertResult {
  config: Config;      // version 1, masterEnabled true, every profile enabled:false
  warnings: string[];  // human-readable, one per lossy mapping
}

// Throws Error("Not a ModHeader export: missing profiles array") on bad input.
export function convertModHeader(raw: unknown): ConvertResult;
```

### Mapping rules (ModHeader v2 → Header Handler)

Per ModHeader `profile` (0-indexed `i`; label = `title` or `Imported profile ${i+1}`):

- **name** = `title` if a non-empty string, else `Imported profile ${i+1}`.
- **enabled** = `false` always. (ModHeader carries no per-profile on/off state;
  no-filter profiles convert to a match-all scope, and dropped excludes broaden
  scope — so nothing fires until the user reviews and enables it.)
- **matcher** = `{ mode: "regex", value }` where `value` is built from the
  profile's **enabled** `urlFilters` (an entry counts if `enabled !== false` and
  `urlRegex` is a non-empty string):
  - 0 contributing filters → `value = ".*"` (match-all) **and** push warning
    `Profile "<name>": no active URL filter → matches all URLs (imported disabled).`
  - 1 → `value = <that urlRegex>`.
  - N>1 → `value = filters.map(f => "(" + f + ")").join("|")` (preserves the
    OR semantics ModHeader gives multiple filters).
- **excludeUrlFilters** non-empty → push warning
  `Profile "<name>": <N> exclude filter(s) dropped (not supported) — headers may apply to URLs you excluded.`
  (Header Handler has no negative match; DNR's RE2 has no lookahead, so excludes
  cannot be represented.)
- Any contributing `urlFilters` entry carrying `methods` → push warning
  `Profile "<name>": HTTP-method filter dropped (not supported) — rule applies to all methods.`
- **respHeaders** non-empty → push warning
  `Profile "<name>": <N> response-header rule(s) dropped — Header Handler only edits request headers.`
- **rules**: per entry in `headers`:
  - Skip silently if `name` is missing/empty/whitespace.
  - `op` = `"set"` (ModHeader request headers add/overwrite; Remove is not
    represented in this array).
  - `value` = `String(h.value ?? "")`.
  - `enabled` = `h.enabled !== false` (preserve ModHeader state; default true).
  - If `h.appendMode === true` → push warning
    `Profile "<name>" header "<hname>": append became overwrite (Set).`
  - Emit `{ id: "", enabled, op: "set", name: <hname>, value }`.
- Emit profile `{ id: "", name, enabled: false, matcher, rules }`.

`config = { version: 1, masterEnabled: true, profiles }`. (For a `g` share,
`encodeShare` serializes only `profiles`, so `masterEnabled` is inert but set for
a well-formed `Config`.) `encodeShare` strips ids on its own, so the empty `id`
values are cosmetic.

### Data flow

1. User pastes ModHeader JSON, clicks **Convert**.
2. `main.ts`: `JSON.parse` the textarea. On `SyntaxError` → show
   `Not valid JSON: <message>`.
3. `convertModHeader(parsed)` → `{ config, warnings }`. On thrown `Error` (not a
   ModHeader export) → show its message.
4. `encodeShare({ kind: "g", config })` → `HH1g…` string.
5. Render: the string in a read-only field with a **Copy** button; a summary
   line (`Converted <P> profiles (<R> header rules). All profiles are imported
   disabled — review scope, then enable them in the extension.`); the warnings
   list (each prefixed `⚠`).

### Error handling

- Bad JSON and non-ModHeader input surface as inline messages; nothing is emitted.
- The mapper never throws on lossy content — it emits and warns.
- The produced string always satisfies `decodeShare`'s `validateProfile`
  (matcher mode `regex` + string value; rule op `set` + string name/value), so a
  successful convert is always importable.

### Testing strategy

- **`modheader.test.ts`** covers: single vs multiple `urlFilters`
  (alternation), no-filter → `.*` + warning, disabled `urlFilters` excluded from
  the matcher, `excludeUrlFilters` warning, `methods` warning, `respHeaders`
  warning, empty-name header skipped, `appendMode` warning, `enabled` preserved,
  profiles always `enabled:false`, and the round-trip
  `decodeShare(encodeShare({kind:"g", config}))` reproducing the profiles.
- **Round-trip test lives in `modheader.test.ts`** using the real `encodeShare`
  / `decodeShare` — proves no drift.
- No DOM/e2e tests for the page glue in v1 (thin, manually verified by loading
  `docs/convert/index.html`).

### Out of scope for Part B

- Any change to the extension's Import UI or `share.ts` — the converter targets
  the existing `HH1g` format unchanged.
- Converters for extensions other than ModHeader (the page is structured so a
  second `convert<X>` module can be added later, but only ModHeader ships now).
- Per-profile (`HH1p`) output; response-header editing; ModHeader "remove"
  semantics; a GitHub Actions Pages deploy (kept on the committed-`/docs` model).
- Preserving ModHeader `excludeUrlFilters`, `methods`, `respHeaders`, or
  `appendMode` semantics — each is dropped with a warning.

---

## Test data note

The ModHeader sample supplied in the request contains a real user's proprietary
domains, internal hostnames, and ticket references. It is **not** stored in the
repo and must **not** appear in tests, fixtures, or docs. Tests use small
synthetic ModHeader objects that exercise the same structure.
