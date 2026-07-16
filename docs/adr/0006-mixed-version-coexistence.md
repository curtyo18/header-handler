# 0006. Mixed-version coexistence: last-write-wins, no old-client guards

Date: 2026-07-16
Status: accepted

## Context

Chunking (ADR-0005) changes the on-disk sync format: a large config becomes a
manifest at `sync:config` (`HHM1…`) plus chunk items. `chrome.storage.sync` is
shared across **all** of an account's devices, and Chrome rolls out extension
updates **per-device, asynchronously** — laptop today, desktop tomorrow. So an
account can transiently run a chunk-aware client and an un-updated (pre-chunking)
client at the same time, both reading and writing the same sync storage.

The un-updated client cannot be migrated — it is running old code you don't
control until it, too, updates. So "migrate on update" (ADR-0005) handles the
single-device upgrade but not the transient mixed-version window. Two things could
go wrong in that window:

1. The old client **crashes or misbehaves** reading the new format.
2. The old client **overwrites** the chunked config on sync and destroys data.

A key constraint bounds the stakes: a config large enough to be chunked is by
definition >8 KB, and an old client physically cannot store one (its own write
would hit `QUOTA_BYTES_PER_ITEM` and reject). There is no correct "large config"
state for an old client to display — it can only ever hold a small one.

Options for the second risk:

- **Active guards.** Generation-fence an old-peer overwrite (detect and refuse to
  adopt it), or keep a capped best-effort single-item mirror at `sync:config` so
  old clients see a valid subset. Both add complexity: fencing needs a conflict
  policy and can strand a genuine edit; a capped mirror needs a truncation policy
  (which profiles to drop?) and creates two semi-authoritative copies with silent
  partial-data risk.
- **Last-write-wins, no guards.** Accept the window; ensure no crash and no
  silent corruption of the *new* client's understanding.

## Decision

Accept the transient mixed-version window with **last-write-wins and no active
guards**, appropriate for a new extension with a small install base.

- **No crash, no old-side code.** An un-updated client reads a `HHM1…` manifest as
  an unrecognized string and falls back to `emptyConfig()` + `console.warn` — this
  is *already* `deserializeConfig`'s behavior (see ADR-0003); nothing new is needed
  on the old side.
- **Old-peer edit wins.** If a user edits on an un-updated client during the
  window, it writes a plain `HHC1…` config to `sync:config`. A chunk-aware client
  reads `sync:config`, sees a config (not a manifest), treats it as the
  authoritative other-device edit, adopts it, and garbage-collects the orphan chunk
  keys on its next write.
- **No mirror, no fence.** `sync:config` is *either* a real config *or* a manifest,
  never both; there is no truncated old-client view to keep consistent, and an
  old-peer write is adopted rather than resisted.

## Consequences

- Zero code on the un-updated side and no truncation/fencing machinery on the new
  side — the existing unrecognized-string fallback is the entire old-client story.
- The accepted failure mode: if a user actively edits on an un-updated client while
  another device holds a chunked config, the chunk-only profiles (which the old
  client never could hold) are lost to last-write-wins. This is inherent to the
  8 KB per-item limit, not a regression introduced here, and is chosen knowingly
  over the complexity of guarding against it.
- Revisitable: if the install base grows and multi-device mixed-version editing
  becomes a real support burden, an active guard (generation-fencing or a capped
  mirror) can be added later without changing the ADR-0005 wire format — the
  manifest already carries the state such a guard would need.
- Documented deliberately so a future maintainer reads this as a chosen trade-off,
  not an overlooked gap.
