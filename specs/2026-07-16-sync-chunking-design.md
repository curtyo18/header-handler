# Chunked Sync Storage — Design

Date: 2026-07-16
Status: accepted

## Goal

Let Header Handler persist configs larger than Chrome's 8 KB per-item sync quota
by splitting the config across multiple `chrome.storage.sync` items, while
preserving cross-device sync and not corrupting the storage for older clients on
the same account.

Today the whole config is one item: `sync:config` holds an LZString-compressed
`HHC1…` string (ADR-0003). `chrome.storage.sync` enforces
`QUOTA_BYTES_PER_ITEM = 8192` (measured as `key length + JSON.stringify(value)`),
and a write past it rejects — so a large config (e.g. a 26-profile ModHeader
import) can no longer be saved. Compression bought ~2–3×; this is the ceiling.

This design raises the effective ceiling to ~10× (a soft cap of ~84 KB stored,
well under the ~100 KB total `QUOTA_BYTES`) by chunking, and confines the
irreversible cross-device format decisions to one manifest object.

## Design principles

1. **Reuse the proven codec.** The config is still serialized to the existing
   `HHC1…` compressed blob (ADR-0003). Chunking operates on that opaque string —
   compression, byte accounting, and the single-string decoder are untouched. A
   single dense profile (a long alternation-regex matcher from the converter)
   simply spans chunks; nothing special-cases it.
2. **Small configs stay byte-for-byte the same.** If the `HHC1…` blob fits one
   item, it is stored at `sync:config` exactly as today. Only a config that
   overflows one item becomes chunked. Small-config users therefore keep *full*
   compatibility with clients that predate chunking.
3. **Confine the hard decisions to one manifest.** Atomicity and cross-version
   coexistence collapse into the manifest's format and read-validation, rather
   than being spread across N-item bookkeeping.
4. **One bad read must not wedge a consumer.** Mirrors `deserializeConfig`'s
   existing stance: any unrecognized, torn, or corrupt state falls back to
   `emptyConfig()` with a `console.warn`, never a throw.

## Storage layout

`chrome.storage.sync` (wxt area `sync:`; the byte quota counts the real Chrome
key, e.g. `config`, `config/0`):

| Key (wxt) | Holds |
| --- | --- |
| `sync:config` | **One of:** a single-item config `HHC1…`; a **chunk manifest** `HHM1…`; a legacy raw `Config` object (v1.1.0); or `null` (fresh install). |
| `sync:config/0` … `sync:config/<n-1>` | **Config chunks** — plain string slices of the `HHC1…` blob. Present only when `sync:config` is a manifest. No marker; addressed by the manifest. |

The single key `sync:config` is always the entry point. Its first bytes tell a
reader which layout it is looking at:

- starts with `HHC1` → single-item config (today's path).
- starts with `HHM1` → chunked; read the chunks it names.
- object → legacy raw config (read, re-serialize on next save).
- anything else / `null` → `emptyConfig()`.

### Manifest format

`HHM1` + `JSON.stringify({ n, len, sum })`:

- `n` — number of chunk items (`sync:config/0..n-1`).
- `len` — character length of the reassembled `HHC1…` blob. The blob is ASCII
  (LZString `compressToEncodedURIComponent` output + the `HHC1` marker), so
  char length equals byte length and slicing needs no multibyte care.
- `sum` — a fast non-cryptographic checksum (cyrb53-style) of the reassembled
  blob. Purpose is torn-read / corruption **detection**, not security.

`HHM1` is the format version (parallel to `HHC1`). A future format bumps the
digit; a reader that doesn't recognize `HHM2…` falls back to empty + warn, the
same forward-compat posture ADR-0003 set for `HHC`.

## Byte budget and constants

Defined in `src/lib/config-codec.ts` (the WXT-free module), so they stay
unit-testable:

| Constant | Value | Meaning |
| --- | --- | --- |
| `SYNC_ITEM_QUOTA_BYTES` | `8192` | Per-item quota (unchanged; still the truth for one item). |
| `SYNC_TOTAL_QUOTA_BYTES` | `102400` | `QUOTA_BYTES` — total across all sync items. |
| `CHUNK_PAYLOAD_BYTES` | `7168` | Max characters per chunk slice. Leaves ≥1 KB/item for the key (`config/<i>`, ≤9 B) + the two JSON quotes, safely under 8192. |
| `MAX_CONFIG_CHUNKS` | `12` | Soft cap on chunk count. |
| `CONFIG_SOFT_CAP_BYTES` | `86016` | `MAX_CONFIG_CHUNKS * CHUNK_PAYLOAD_BYTES` (~84 KB). The effective config ceiling. |

Worst case at the cap: 12 chunks × (~8 B key + 7168 + 2) + manifest (~48 B) ≈
86 KB — leaving ~16 KB of the 100 KB total for the manifest, write bursts, and
any future sync items. This is the reason for the soft cap rather than maxing
out `QUOTA_BYTES` (see ADR-0005).

## Components and interfaces

Pure logic stays in `src/lib/config-codec.ts` (no WXT, unit-tested). Orchestration
of the multi-item read/write stays in `src/lib/storage.ts`'s `configStore` facade,
which keeps its existing `Config`-typed `getValue` / `setValue` / `watch` surface —
no caller outside `storage.ts` changes shape.

### config-codec.ts (pure)

```ts
// Unchanged: single-string serialize / deserialize / single-item byte measure.
export function serializeConfig(cfg: Config): string;        // -> "HHC1…"
export function deserializeConfig(raw: unknown): Config;      // string | object | null -> Config

// New — chunk planning and reassembly, all pure over strings.

// Decide the on-disk layout for a serialized blob.
//  - blob fits one item          -> { kind: "single", value: blob }
//  - blob needs 2..MAX chunks    -> { kind: "chunked", chunks: string[], manifest: string }
//  - blob exceeds the soft cap   -> throws Error containing "quota" (surfaced by the UI)
export function planStorage(blob: string):
  | { kind: "single"; value: string }
  | { kind: "chunked"; chunks: string[]; manifest: string };

export function parseManifest(value: string): { n: number; len: number; sum: number } | null;

// Validate len + sum against the concatenated chunks, then deserialize.
// On any mismatch (torn/corrupt read) -> emptyConfig() + console.warn.
export function reassembleConfig(manifest: { n: number; len: number; sum: number }, chunkValues: (string | null)[]): Config;

export function checksum(s: string): number;   // cyrb53-style, deterministic

// Total bytes the config occupies across all its items (single or chunked),
// for the near-quota UI. Measured on the stored representation, not raw JSON.
export function configStorageBytes(cfg: Config): number;
```

`fitsOneItem(blob)` is the internal predicate `planStorage` uses:
`keyBytes("config") + jsonBytes(blob) <= SYNC_ITEM_QUOTA_BYTES`.

### storage.ts (facade, WXT)

Chunk keys use the derived helpers `chunkKey(i) => \`sync:config/${i}\``. The
facade batches with wxt's `storage.getItems` / `storage.setItems` /
`storage.removeItems`.

```ts
export const configStore = {
  getValue: async (): Promise<Config> => {
    const raw = await rawConfigStore.getValue();          // "sync:config"
    const manifest = typeof raw === "string" ? parseManifest(raw) : null;
    if (!manifest) return deserializeConfig(raw);         // single-item / legacy / null / HHC1
    const keys = Array.from({ length: manifest.n }, (_, i) => chunkKey(i));
    const items = await storage.getItems(keys);           // batch read all chunks
    return reassembleConfig(manifest, items.map((r) => r.value as string | null));
  },

  setValue: (cfg: Config): Promise<void> => coalesceWrite(cfg),   // debounced; see below

  watch: (cb) => rawConfigStore.watch(async () => cb(await configStore.getValue())),
};
```

**Write path (`coalesceWrite` → `flushWrite`).** Chosen strategy: *debounce +
rewrite all chunks* (see "Write-rate strategy" below).

1. `serializeConfig(cfg)` → blob. `planStorage(blob)`.
   - If it throws (over soft cap): reject the returned promise with the
     quota-flavoured error **before any write** — so the save is atomic-in-intent
     and the UI shows the size message deterministically rather than after a
     partial multi-item write.
2. Read current chunk count to know what to garbage-collect: read `sync:config`;
   if it is a manifest, its `n` is the previous chunk count (else 0).
3. **single** result: write `sync:config = value`; then remove any orphan chunk
   keys `sync:config/0..prevN-1`.
4. **chunked** result: write chunks `sync:config/0..n-1` **first** (one
   `setItems` batch), remove orphan chunk keys `sync:config/n..prevN-1`, then
   write `sync:config = manifest` **last**. Manifest-last means a reader never
   sees a manifest that points past the chunks that exist for it.

### Watch semantics

`watch` fires on any `sync:config` change and re-runs `getValue`. Because the
manifest is always written last, its change is the single edge that signals a
complete new generation; the re-read then pulls the fresh chunks in one batch.
Chunk-key changes need not be watched individually.

## Data flow

**Read (large config):** `getValue` → `sync:config` is `HHM1{n,len,sum}` →
batch-get `config/0..n-1` → `reassembleConfig` validates `len`+`sum` → concatenate
→ `deserializeConfig` on the `HHC1…` blob → `Config`.

**Write (grows past one item):** edit → (debounce) → `serializeConfig` →
`planStorage` returns `chunked` → write chunks, GC orphans, write manifest last →
promise resolves → UI shows "Saved".

**Write (shrinks back under one item):** `planStorage` returns `single` → write
`sync:config = HHC1…`, remove leftover chunk keys → back to the classic layout.

## Migration (lazy, on write)

No eager `onInstalled` rewrite. Two facts make lazy migration correct and
strictly simpler:

- **Reads are already backward-tolerant.** A legacy raw object and a v1.2.0
  `HHC1…` both read via the unchanged `deserializeConfig` path.
- **A >8 KB config cannot already exist in storage.** v1.2.0 could never write
  one, so after an update the stored config is always a ≤8 KB single item. It
  reads fine; the *first save that pushes it over one item* writes the chunked
  format. Migration is therefore the ordinary write path, not a special step.

An eager migration would cost a write on every update and buy nothing — declined.

## Cross-version coexistence

The load-bearing, irreversible decision. Full rationale in **ADR-0006**; summary:

- `chrome.storage.sync` is shared across all of an account's devices, and Chrome
  updates extensions per-device asynchronously — so an account can transiently
  run both a chunk-aware client and an un-updated one.
- An un-updated client reads a `HHM1…` manifest as an **unrecognized string** →
  `emptyConfig()` + `console.warn` (this is *already* today's behavior in
  `deserializeConfig`; no old-side code exists or is needed). It never crashes.
  It also physically cannot hold a >8 KB config, so there is no correct larger
  state for it to show.
- **Last-write-wins, no active guards.** If a user edits on an un-updated client
  during the window, it writes a plain `HHC1…` to `sync:config`. A chunk-aware
  client then reads `sync:config` as a config (not a manifest), treats it as the
  authoritative other-device edit, adopts it, and GCs the orphan chunks on its
  next write. Chunk-only profiles the old client never could hold are lost — an
  outcome inherent to the 8 KB limit, accepted here deliberately for a new
  extension with a small install base rather than engineered around.

## Error handling

- **Over soft cap:** `planStorage` throws an `Error` whose message contains
  `quota`; `configStore.setValue` rejects with it before writing. `main.tsx`'s
  existing `/quota/i` branch maps it to the size banner (copy retargeted to the
  ~84 KB total budget).
- **Torn / corrupt read:** `reassembleConfig` returns `emptyConfig()` +
  `console.warn` on any `len`/`sum` mismatch or a missing chunk — never throws.
- **Unrecognized `sync:config`:** `deserializeConfig` returns `emptyConfig()` +
  `console.warn` (unchanged).

## UX changes (`entrypoints/options/main.tsx`)

Budget shifts from one 8 KB item to the ~84 KB total soft cap. All product-code
changes are deferred to implementation; the design intent:

- `nearQuota` compares `configStorageBytes(cfg)` against
  `CONFIG_SOFT_CAP_BYTES * 0.8` (not `SYNC_ITEM_QUOTA_BYTES`).
- Near-quota banner copy: report bytes-used against the ~84 KB budget, not the
  8 KB item limit.
- `saveErrorMessage`'s `/quota/i` copy: "over the ~84 KB sync-storage budget —
  remove some rules or profiles," dropping the "8 KB" figure.
- The `Saved` / `Saving…` / `Save failed` pill and the debounce/settle timers are
  unchanged in behavior.

## Write-rate strategy

`chrome.storage.sync` caps writes at `MAX_WRITE_OPERATIONS_PER_HOUR = 1800`
(the current binding rate limit; the old per-minute sustained cap is retired).
Chunking multiplies items-per-save, so:

- **Debounce/coalesce** saves: `coalesceWrite` keeps only the latest pending
  `Config` and flushes on a trailing timer, collapsing a burst of edits (typing,
  a bulk import) into one write. A bulk 26-profile import is a single `update()`
  → a single flush of ≤12 chunk writes.
- **Rewrite all chunks** per flush (simplest correct). At ≤12 items/flush and a
  human editing cadence this stays far under 1800/hr.
- **Slice-diffing** (rewrite only changed chunks) is a deliberate *later*
  optimization, not in v1 — noted so the manifest format doesn't preclude it.

## Testing strategy

- **config-codec.test.ts** (pure, no browser):
  - `planStorage`: blob under one item → `single`; blob needing 2..12 chunks →
    `chunked` with correct slice boundaries and a manifest whose `n`/`len`/`sum`
    match; blob over the soft cap → throws with a `quota` message.
  - `parseManifest`: valid `HHM1…` round-trips; `HHC1…`, junk, and `null` →
    `null`.
  - Round-trip: `reassembleConfig(planStorage(serializeConfig(cfg)))` reproduces
    `cfg` for small, boundary (exactly one item), and large (multi-chunk) configs.
  - Torn read: `reassembleConfig` with a missing chunk, a truncated chunk, or a
    wrong `sum` → `emptyConfig()` (and asserts a warning was logged).
  - `checksum` is stable and order-sensitive.
  - `configStorageBytes` counts all items (single and chunked).
- **storage.test.ts** (fake browser, mirroring existing storage tests): a large
  config writes chunk items + a manifest and reads back equal; shrinking removes
  orphan chunk keys; a manifest pointing at a missing chunk reads as empty; an
  old-peer `HHC1…` overwrite of `sync:config` is read as authoritative and its
  orphan chunks are GC'd on the next write.
- **Coalescing:** rapid `setValue` calls result in one flush carrying the last
  value.

## Out of scope

- **Slice-diff / changed-chunk-only writes** — deliberately deferred (above).
- **Active cross-version guards** (generation-fencing an old-peer overwrite, a
  capped best-effort mirror for old clients) — rejected in ADR-0006.
- **`storage.local` overflow tier** — rejected: it does not sync, stranding the
  capacity users off cross-device sync, the core feature (restates ADR-0003).
- **Per-profile item layout** — rejected: a single dense profile can still exceed
  8 KB, so it fails the exact case that motivates this work, and it adds orphan
  GC and bookkeeping the blob-slice approach avoids.
- **Any change to the share-string format (`HH1…`), the ModHeader converter, or
  the pages under `pages/convert/`** — unrelated.
- **A server/remote sync tier** — the extension is explicitly no-server,
  no-remote-code; off-device storage is out of scope.
- **Raising the cap to the full `QUOTA_BYTES` / `MAX_ITEMS`** — the soft cap
  intentionally leaves headroom (ADR-0005).
