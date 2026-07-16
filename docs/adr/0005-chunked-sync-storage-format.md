# 0005. Chunked sync-storage format

Date: 2026-07-16
Status: accepted

## Context

The whole config is stored as a single `chrome.storage.sync` item (`sync:config`),
an LZString-compressed `HHC1…` string (ADR-0003). `chrome.storage.sync` enforces
`QUOTA_BYTES_PER_ITEM = 8192` per item (measured as `key length +
JSON.stringify(value)`), and a write past it rejects. Compression bought ~2–3×
and is now the ceiling: a large config — e.g. a 26-profile ModHeader import whose
matchers are long alternation regexes — exceeds 8 KB even compressed, and can no
longer be saved.

ADR-0003 explicitly considered and rejected splitting across multiple items
("adds partial-write/consistency complexity and a migration"). That trade-off has
flipped: the import feature now routinely produces configs past the single-item
ceiling, so the complexity has to be paid. This ADR supersedes that one rejected
alternative in 0003; the rest of 0003 (compress at rest, `HHC1` marker, legacy
read-tolerance) stands and is reused here.

The total sync quota is far larger than one item — `QUOTA_BYTES = 102400`,
`MAX_ITEMS = 512` — so the capacity exists; it just has to be spread across items.
The storage format syncs across a user's devices, which (like the share format in
ADR-0002) makes it effectively permanent once shipped, so the layout and its
read-validation are decided up front.

Alternatives considered:

- **Per-profile items** (one item per profile). Smaller diffs and partial reads,
  but a single dense profile (a long alternation-regex matcher) can *still* exceed
  8 KB — it fails the exact case that motivates this work — and it adds orphan-item
  GC and manifest bookkeeping. Rejected.
- **`storage.local` overflow tier.** Larger per-item quota, but it does not sync;
  it strands the capacity users off cross-device sync, the core feature. Rejected
  (restates ADR-0003).
- **Max out `QUOTA_BYTES` / `MAX_ITEMS`.** Maximum capacity, but no headroom for a
  non-atomic multi-item write or future sync items near the ceiling. Rejected in
  favour of a soft cap.

## Decision

Split the existing `HHC1…` compressed blob across multiple sync items, keyed off a
manifest at the well-known `sync:config` key. Reuse the whole ADR-0003 codec — the
config is still serialized to `HHC1…`; chunking operates on that opaque string.

- **Small configs are unchanged.** If the blob fits one item it is stored at
  `sync:config` exactly as today. Only a blob that overflows one item is chunked.
- **Chunked layout:** `sync:config` holds a manifest `HHM1` +
  `{ n, len, sum }` (chunk count, reassembled length, cyrb53-style checksum);
  chunks are plain slices at `sync:config/0..n-1`. The blob is ASCII, so byte
  length equals char length and slicing is trivial.
- **Read** keys off the first bytes of `sync:config`: `HHC1…` → single item;
  `HHM1…` → read the named chunks, validate `len`+`sum`, reassemble, decode;
  legacy object → read + re-serialize on next save; anything else → `emptyConfig()`.
- **Write** is *debounce + rewrite-all-chunks*: coalesce a burst of edits into one
  flush; write chunks first, GC orphan chunk keys, write the manifest **last** so a
  reader never sees a manifest pointing past its chunks. A blob over the soft cap
  rejects the save *before any write*, with a quota-flavoured error the UI already
  handles.
- **Soft cap:** `CHUNK_PAYLOAD_BYTES = 7168`, `MAX_CONFIG_CHUNKS = 12` →
  `CONFIG_SOFT_CAP_BYTES ≈ 86 KB`. Deliberately below `QUOTA_BYTES` to leave ~16 KB
  headroom for the manifest, write bursts, and future items — no write should ever
  hit the total-quota or `MAX_ITEMS` ceiling mid-flush.
- **Torn/corrupt reads never throw:** any `len`/`sum` mismatch or missing chunk
  falls back to `emptyConfig()` + `console.warn`, matching `deserializeConfig`'s
  existing "one bad item must not wedge every consumer" stance.
- **Migration is lazy:** reads are backward-tolerant; the first save that overflows
  one item writes the chunked format. No eager `onInstalled` rewrite (a >8 KB
  config cannot already exist in storage, so there is nothing to migrate eagerly).

Cross-version coexistence (what an un-updated client does with a manifest) is a
separable, load-bearing decision recorded in ADR-0006.

## Consequences

- Raises the effective config ceiling ~10× (8 KB → ~84 KB) while keeping
  cross-device sync and adding no dependency.
- Commits to a permanent, self-describing entry point: `sync:config` is always the
  reader's starting item, and its `HHC1` / `HHM1` prefix selects the layout. A
  future format bumps the manifest version digit and keeps the old path.
- A save now writes up to 13 items (12 chunks + manifest); debouncing keeps this
  well under `MAX_WRITE_OPERATIONS_PER_HOUR = 1800`. Slice-diffing to rewrite only
  changed chunks is left as a future optimization the format already permits.
- Chunk values are opaque slices in DevTools — a minor debuggability cost, already
  true of the compressed single item.
- The manifest is written non-atomically after its chunks; within a single device
  writes complete before reads, and the `len`+`sum` check plus manifest-last
  ordering make a torn read fall back safely rather than parse as real.
