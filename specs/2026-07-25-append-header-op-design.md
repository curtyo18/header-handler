# Append Header Operation — Design

Date: 2026-07-25
Status: accepted

**Correction (2026-07-25, post-merge):** the original version of this spec assumed DNR's `append` operation joins values with a plain comma for every header, and that Cookie/Set-Cookie/Authorization were merely "risky" cases needing a soft warning. Verified afterward against Chrome's own primary docs (https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest): (1) Chrome only supports `append` at all for a fixed 21-header allowlist — Authorization is not on it, so appending to it is rejected outright, not "risky"; (2) the separator is header-appropriate, not always comma (confirmed by live testing: `User-Agent` uses a space) — Chrome's docs don't specify per-header separator characters beyond "the browser will use the appropriate separator where possible." The sections below are corrected to match. See `src/lib/dnr-headers.ts` for the allowlist and the `fix/append-allowlist-validation` branch for the follow-up validation work this correction describes.

## Goal

Add a third header operation, **Append**, alongside the existing Set and
Remove: instead of replacing a header's value, it adds a value onto whatever
is already there. This closes the gap called out in the ModHeader converter
today, where `appendMode: true` is detected only to emit a "became overwrite
(Set)" warning and silently downgrades to Set.

## Platform constraint (why this is scoped the way it is)

MV3's `declarativeNetRequest` (DNR) is purely declarative — no extension code
runs per-request to read a header's current value and compute a new string.
Blocking `webRequest` (which could do that) is unavailable to a normal
Chrome-Web-Store extension since MV3; it's restricted to extensions an
organization force-installs on its own managed fleet via enterprise policy,
which is not this extension's distribution model.

DNR exposes exactly one native operation for this: `HeaderOperation.append`,
which joins the new value onto the existing one internally, using whatever
separator Chrome considers appropriate for that specific header — no custom
separator, no read-and-compute, and Chrome's docs don't enumerate the exact
character per header (confirmed by live testing: `User-Agent` uses a space).
Confirmed via research that ModHeader itself, after its own MV3 migration,
maps its `appendMode` onto this same DNR `append` operation — so this design
matches ModHeader's current actual mechanism, not just an approximation of
its old MV2 behavior.

**Header allowlist (confirmed against Chrome's own docs):** `append` is only
supported for a fixed set of 21 request headers — `accept`, `accept-encoding`,
`accept-language`, `access-control-request-headers`, `cache-control`,
`connection`, `content-language`, `cookie`, `forwarded`, `if-match`,
`if-none-match`, `keep-alive`, `range`, `te`, `trailer`, `transfer-encoding`,
`upgrade`, `user-agent`, `via`, `want-digest`, `x-forwarded-for` (see
`src/lib/dnr-headers.ts`). Notably `authorization` is **not** on this list —
appending to it, or to any custom header, is rejected by Chrome outright.
The editor validates against this allowlist (`ruleHasBlockingError` in
`HeaderRow.tsx`) so a rule targeting an unsupported header is flagged before
it ever reaches DNR.

**DNR ordering constraint:** once a rule appends to a header, Chrome only
permits *lower-priority* rules touching that same header to also append — a
Set or Remove at lower priority is rejected when the rule set is registered.
See Error handling below for how this surfaces.

## Data model

`HeaderOp` gains a third variant, mirroring DNR's own three-value operation
enum (`set` / `append` / `remove`) — chosen over an `appendMode?: boolean`
modifier on Set because it maps 1:1 onto the DNR enum, avoids a compound
state that's only meaningful for one op value, and needs no special-casing
in validation beyond what a new enum member already requires.

```ts
// src/types.ts
type HeaderOp = "set" | "remove" | "append";
```

`HeaderRule.value` becomes required (like today's Set) for `append` too — no
new fields. No `Config.version` bump: `HeaderRule`'s shape is unchanged, only
the set of valid `op` string values grows, and nothing in `config-codec.ts`
or `storage.ts` branches on schema version. No share-format version bump
either: `HH1g`/`HH1p` strings are unaffected in shape, only `share.ts`'s
`validateRule` allowlist grows — decoding pre-existing share strings is
unaffected.

## Components / files touched

| File | Change |
| --- | --- |
| `src/types.ts` | `HeaderOp` gains `"append"`. |
| `src/lib/compile.ts` | Replace the `set`/else-`remove` ternary (lines 52-57) with a switch over all three ops; `operation: rule.op` passes straight through to `chrome.declarativeNetRequest.HeaderOperation` (its values already are `"set"`/`"append"`/`"remove"`); `value` included for both `set` and `append`. |
| `entrypoints/options/HeaderRow.tsx` | Third `<option value="append">` in the op `<select>`; a `?` help icon/tooltip next to it explaining the comma-join/no-custom-separator mechanism; the value field stays enabled for `append` (today's `rule.op === "remove" ? disabled : <ValueEditor>` branch already treats non-remove as editable, so this is a no-op change there); `ruleHasBlockingError`'s JSON-value check (currently `rule.op === "set"` only, line 22) extends to `rule.op === "append"`. |
| `src/lib/modheader.ts` | `appendMode: true` maps to `op: "append"` instead of downgrading to `op: "set"` with a warning. New targeted warning (see Mapping rules) for a small set of headers with non-standard combining semantics. |
| `src/lib/share.ts` | `validateRule`'s allowlist (line 28) admits `"append"`. |
| `CONTEXT.md` | Already updated with an **Append** glossary entry (this conversation). |

## Mapping rules (ModHeader converter)

Per header entry in a ModHeader profile's `headers` array:

- `h.appendMode === true` and the header is on Chrome's append allowlist
  (`isAppendableHeader`) → `op: "append"`, no warning — a faithful, lossless
  conversion (matches ModHeader's own current mechanism).
- `h.appendMode === true` but the header is **not** on the allowlist (e.g.
  `Authorization`, or any custom header) → falls back to `op: "set"` (the
  original pre-append-feature behavior) with a warning:
  `Profile "<name>" header "<hname>": Chrome doesn't support Append for this
  header — imported as Set (overwrite) instead.`
  This avoids ever emitting an append rule Chrome would reject outright.

## Editor UX

- Op `<select>` gets a third option, `Append`, positioned after `Set` and
  before `Remove` (mirrors the Set→Append value continuity; Remove stays
  last since it's the odd one out with no value field).
- A `?` icon next to the `<select>` (or inline help text shown when `Append`
  is selected) explains that Chrome performs the join internally using
  whatever separator it considers appropriate for that header, that
  extension code never reads the old value, and that only a fixed set of
  headers support it at all (not Authorization or custom headers).
- `ruleHasBlockingError` blocks an Append rule whose header name isn't on
  Chrome's append allowlist (`isAppendableHeader`, `src/lib/dnr-headers.ts`),
  the same way it already blocks an invalid override-matcher regex or
  unparseable JSON value — flagged before the rule ever reaches DNR, not
  discovered only via the generic DNR-rejection banner after saving.

## Error handling

The DNR ordering constraint (append vs. lower-priority set/remove on the same
header) is **not** given new proactive validation. The existing mechanism
already covers it: `updateDynamicRules` rejects the conflicting batch, the
existing individual-retry-and-skip fallback isolates the offending rule, and
the persistent options-page banner surfaces Chrome's own rejection text. This
is the same generic path that already handles other DNR-level rejections
(spec: `specs/2026-07-11-header-handler-design.md`, Error handling section) —
adding a bespoke pre-check would mean re-deriving DNR's exact priority
resolution order without a documented source to verify it against, for a
failure mode the generic mechanism already surfaces clearly. Revisit only if
the generic banner proves too vague in practice.

All other error paths (bad JSON on import, invalid regex matcher, import
overwrite prompts) are unchanged by this feature.

## Testing strategy

Extend existing suites rather than add new ones — this feature is a third
enum variant threaded through code that already tests the other two:

- `src/lib/compile.test.ts` — add an `append` case asserting
  `operation: "append"` and that `value` is present (mirrors the existing
  `set` case).
- `src/lib/share.test.ts` — add an `append` round-trip case alongside the
  existing `goodRule` fixture; confirm the existing invalid-op rejection
  test (`op: "hack"`) still throws.
- `src/lib/modheader.test.ts` — rewrite the current `appendMode: true`
  assertion (today expects a downgrade warning) to expect `op: "append"`
  with no warning for a generic header name, plus a new case asserting the
  targeted warning fires for `Cookie`/`Set-Cookie`/`Authorization`
  (case-insensitive).
- `entrypoints/options/HeaderRow.test.tsx` — extend the `baseRule()` fixture
  usage and `ruleHasBlockingError` tests to cover `op: "append"` with a
  JSON-shaped value (should block, same as `set` today).
- No changes needed to `config-codec.test.ts`, `matches.test.ts`,
  `storage.test.ts`, `import.test.tsx`, or `main.test.tsx` — none of them
  assert on the specific set of valid `op` values.

## Out of scope

- A custom separator or "true" single-line string concatenation — not
  achievable under MV3 DNR (see Platform constraint above).
- Proactive compile-time validation of the append/set-remove priority
  conflict — deferred to the existing generic DNR-rejection banner (see
  Error handling above).
- Per-header combining-semantics warnings beyond the Cookie/Set-Cookie/
  Authorization set called out above (e.g. no attempt to maintain an
  exhaustive list of every header with non-standard combining rules).
- Response-header append (response headers are already out of scope for the
  whole extension, per `specs/2026-07-11-header-handler-design.md`).
- Any change to the Live log's rule-matching/reconstruction logic — it
  already treats `op` opaquely for display purposes.
