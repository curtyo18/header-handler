# Header Handler — Design

**Date:** 2026-07-11
**Status:** Approved for planning

## Goal

A Chrome (MV3) extension that rewrites **outgoing request headers** using rules organized into shareable **profiles**. Users create profiles with a URL **matcher** and a list of Set/Remove header rules, toggle multiple profiles on at once, share configs via compressed strings, and watch a **live log** side panel of the requests their rules touched.

## Tech stack

- **WXT** (Vite-based, generates `manifest.json` from `entrypoints/`). No hand-written manifest.
- **Preact** for popup, options page, and side panel UI (JSX via `jsxImportSource: "preact"`).
- **`declarativeNetRequest`** (DNR) dynamic rules — the only supported way to modify headers in MV3.
- **`webRequest`** (read-only / non-blocking) + `extraHeaders` — feeds the live log.
- **`lz-string`** — compresses config JSON to a URL-safe share string.
- **WXT `storage`** typed wrappers over `chrome.storage`.
- **No Tailwind** — CSS custom properties, dark-only (`color-scheme: dark`).
- TypeScript throughout.

## Surfaces (UI topology)

Three surfaces, each playing to its strength:

| Surface | Owns | Notes |
|---|---|---|
| **Popup** (`action`) | Master switch, per-profile on/off toggles, "Open panel" button, "Open options" link | Small, fast. No editing here. |
| **Options page** | Full CRUD of profiles + header rules, matchers, Import/Export | The config workbench, opens in a full tab. |
| **Side panel** (`sidePanel`) | Live log of matched requests + observed headers; per-request "which rules applied" | Persistent while browsing. Session-only. |

## Data model

Stored in `chrome.storage.sync` (config is small, benefits from cross-device sync). Live log state is **not** stored — it lives in `chrome.storage.session` / in-memory only.

```ts
type MatchMode = "contains" | "exact" | "starts" | "ends" | "domain" | "regex";

interface Matcher {
  mode: MatchMode;
  value: string; // substring, url, domain, or regex source depending on mode
}

type HeaderOp = "set" | "remove";

interface HeaderRule {
  id: string;            // uuid
  enabled: boolean;
  op: HeaderOp;
  name: string;          // header name, e.g. "Authorization"
  value?: string;        // required for "set", ignored for "remove"
  matcher?: Matcher;     // optional; overrides the profile matcher for this rule only
}

interface Profile {
  id: string;            // uuid
  name: string;
  enabled: boolean;      // participates in the active union when true
  matcher: Matcher;      // default matcher for all header rules in the profile
  rules: HeaderRule[];
}

interface Config {
  version: 1;            // schema version (independent of share-format version)
  masterEnabled: boolean;
  profiles: Profile[];
}
```

**Precedence:** the applied rule set is the union of header rules across all `enabled` profiles while `masterEnabled` is true. Each header rule matches against its own `matcher` if present, otherwise its profile's `matcher`. Two enabled rules targeting the same header on the same request resolve by **DNR rule priority** (later-defined profile wins; documented and stable, see Rule compilation).

## Matcher → DNR translation

The match modes map onto DNR conditions with **no runtime regex engine of our own** for the common cases:

| Mode | DNR condition |
|---|---|
| `contains` | `urlFilter: value` (DNR substring match, the default semantics) |
| `starts` | `urlFilter: "\|" + value` (`\|` anchors to URL start) |
| `ends` | `urlFilter: value + "\|"` (`\|` anchors to URL end) |
| `exact` | `urlFilter: "\|" + value + "\|"` (both anchors) |
| `domain` | `requestDomains: [value]` (and subdomains) |
| `regex` | `regexFilter: value` (RE2 syntax; counts against DNR's regex-rule limit) |

`urlFilter` special characters (`|`, `*`, `^`) in user substrings are escaped for the non-regex modes so a literal Contains never accidentally anchors.

## Rule compilation

On any config change (and on service-worker wake), recompile:

1. If `!masterEnabled`, clear all dynamic rules and stop.
2. Walk enabled profiles in array order. For each enabled header rule, emit one DNR dynamic rule:
   - `action.type = "modifyHeaders"`, `action.requestHeaders = [{ header, operation: op === "set" ? "set" : "remove", value }]`.
   - `condition` from the effective matcher (rule matcher ?? profile matcher).
   - `priority` = 1 + profile index, so later profiles override earlier ones deterministically.
   - `id` = a stable integer derived from a monotonic counter kept in storage (DNR needs integer ids; we map uuid↔int in a persisted table).
3. Diff against currently-installed rules; call `updateDynamicRules({ addRules, removeRuleIds })` with only the delta.

**Limits acknowledged:** DNR dynamic rules cap (30k total; ~1k `regexFilter` rules). Custom-regex matchers are the only ones that consume the regex budget. If a compile would exceed a limit, surface a non-blocking error in the options page and skip the overflowing rules.

## Live log (the debug view)

DNR is opaque: a published extension cannot observe which rule fired. Therefore the log is a **reconstruction**, not ground truth (see ADR 0001).

- Register non-blocking `webRequest.onSendHeaders` (with `["extraHeaders"]`) for `<all_urls>` under `host_permissions`.
- For each observed request, run the **same matcher-evaluation logic** used for compilation (shared module) against the active config to decide which rules *should* have applied.
- If any rule matched, push a log entry: `{ ts, method, url, requestHeaders[], matchedRuleIds[] }`.
- The panel renders newest-first, groups by tab, and shows all observed request headers with the matched ones highlighted. A row expands to show which profile/rule matched.
- **Session-only:** entries live in an in-memory ring buffer in the service worker mirrored to `chrome.storage.session`; cleared on browser close. A "Clear" button empties it. Nothing touches `storage.local`/disk.

## Share strings (import/export)

Compressed, URL-safe, version-tagged. See ADR 0002.

- **Format:** `HH` + `<format-version:1 char>` + `<kind:1 char>` + `lzstring(JSON)`.
  - `kind` = `p` (single profile) or `g` (global — full config).
  - JSON payload: for `p`, a single `Profile`; for `g`, `{ profiles: Profile[] }`. `id`s are **stripped on export** and regenerated on import (ids are local).
- Compression via `LZString.compressToEncodedURIComponent` / `decompressFromEncodedURIComponent`.
- **Export:** options page → per-profile "Export" (produces a `p` string) and a top-level "Export all" (produces a `g` string). Copy-to-clipboard.
- **Import (single profile):** imports **under its original name**. If a profile with that name exists, prompt: **Overwrite** (replace that profile's contents) or **Cancel**.
- **Import (global):** imports every profile; for each name collision, the same overwrite/skip prompt (with an "apply to all" option).
- **Validation:** reject on bad prefix, unknown format-version, decompress failure, or schema-invalid payload — show a clear error, never partially apply.

## Error handling

- Invalid custom regex in a matcher → inline validation in the editor before save; never compiled.
- DNR `updateDynamicRules` rejection → caught, surfaced as a toast in the options page with the DNR error text; config stays saved so the user can fix and recompile.
- Import failures → single error message, no mutation.
- Service-worker restart → compilation and log buffer rehydrate from `storage.sync` / `storage.session` on wake.

## Testing strategy

- **Pure units (Vitest):** matcher→DNR translation table (every mode + escaping), matcher evaluation (used by both compile and log), share-string round-trip (encode→decode equality; version/kind parsing; corrupt-input rejection), rule compilation diffing (add/remove deltas), uuid↔int id mapping stability.
- **Component (Vitest + Preact Testing Library):** profile/rule editors, import overwrite-prompt flow, popup toggles.
- **Manual smoke (documented checklist):** load unpacked, create a profile, hit a test endpoint (e.g. httpbin `/headers`), confirm header applied and log entry appears; export→import round-trip across a fresh profile.
- No E2E harness for DNR itself — it's Chrome-internal; covered by the manual checklist.

## Privacy & store review

- The live log observes **all** request headers (including `Authorization`, `Cookie`) for matched requests. This must be disclosed plainly in `docs/privacy.html`: headers are read to display in the panel, held in memory for the session only, never transmitted or persisted.
- `host_permissions: <all_urls>` justification: header rewriting and the observer must work on any site the user targets; narrower grants can't be known ahead of the user's rules.
- No analytics, no remote code, no network calls originated by the extension.

## Out of scope (v1)

- **Response** header modification (request-only for v1).
- Ground-truth per-request rule attribution in production (only reconstruction; `onRuleMatchedDebug` optionally powers a more accurate log when loaded unpacked — nice-to-have, not v1).
- Redirects, request blocking/cancellation, resource-type/method conditions (matcher is URL-based only in v1).
- Firefox/Edge packaging (WXT makes it cheap later, but not a v1 target).
- Cloud sync / accounts / team sharing beyond the share string.
- Value templating (env vars, dynamic tokens) in header values.
