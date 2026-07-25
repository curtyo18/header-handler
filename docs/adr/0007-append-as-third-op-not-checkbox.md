# 0007. Append as a third HeaderOp value, not a checkbox modifier on Set

Date: 2026-07-25
Status: accepted

## Context

Adding Append support meant choosing how to represent it in the data model.
ModHeader itself represents append as a boolean `appendMode` flag attached to
a header entry that is otherwise a plain Set — the header op is implicitly
always "set", and `appendMode` toggles whether it replaces or appends. That
was the more obvious choice to mirror, since it's the format already being
read in `src/lib/modheader.ts`.

The alternative was extending `HeaderOp` from `"set" | "remove"` to
`"set" | "remove" | "append"` — a third top-level operation rather than a
modifier.

This choice is hard to reverse once shipped: `HeaderOp` values are persisted
in `chrome.storage.sync` and embedded in exported share strings
(`HH1g…`/`HH1p…`) that users paste into other installs. Changing the
representation later means migrating both live storage and the meaning of
already-shared strings.

## Decision

Chose the third-enum-value form (`"append"`) over a boolean modifier on Set.

Reasoning: `chrome.declarativeNetRequest`'s own `HeaderOperation` type is
`"append" | "set" | "remove"` — three flat values, not a modifier on set.
Mirroring that means `compile.ts` becomes a direct pass-through/switch
instead of needing to interpret a compound `(op, appendMode)` state, and the
editor UI adds one dropdown option instead of a checkbox whose visibility
and meaning depend on which op is currently selected.

## Consequences

- `src/lib/compile.ts`, `src/lib/share.ts`, and the options-page editor each
  treat `op` as a flat three-way value with no cross-field validity rules
  (e.g. no need to reject `{ op: "remove", appendMode: true }` as
  nonsensical — that combination simply can't be expressed).
- The ModHeader converter (`src/lib/modheader.ts`) translates ModHeader's own
  `(headers-array-entry, appendMode)` shape into this flatter one on import;
  that mapping is a one-time, one-directional translation and does not need
  to persist ModHeader's own representation anywhere downstream.
- Rules this out: if a future header operation needs to compose with Set
  independently of Append (hypothetically), it can't reuse an `appendMode`-
  style boolean precedent — each new op is its own enum value.
