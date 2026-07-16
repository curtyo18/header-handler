# Chunked Sync Storage Implementation Plan

**Goal:** Persist configs larger than Chrome's 8 KB per-item sync quota by
splitting the compressed `HHC1…` blob across multiple `chrome.storage.sync` items
behind a manifest, raising the effective ceiling to ~84 KB while keeping
cross-device sync and old-client tolerance.

**Architecture:** All chunk logic is pure and lives in `src/lib/config-codec.ts`
(WXT-free, unit-tested): constants, a checksum, `planStorage` (blob → single or
chunked layout), `parseManifest`, and `reassembleConfig` (validate + decode). The
`configStore` facade in `src/lib/storage.ts` orchestrates the multi-item
read/write (batch get/set/remove, orphan GC, manifest-last ordering, a coalescing
debounce) behind its unchanged `Config`-typed `get/set/watch` surface. `main.tsx`
retargets its byte accounting and copy from the 8 KB item limit to the ~84 KB
total budget. See `specs/2026-07-16-sync-chunking-design.md`, ADR-0005, ADR-0006.

**Tech Stack:** TypeScript, wxt 0.19 `storage` (batch `getItems`/`setItems`/
`removeItems`), `lz-string` (already a dep, via the existing codec), Preact,
vitest (jsdom).

---

## Prerequisite (clean checkout)

```bash
npm ci
npx wxt prepare   # generates .wxt/tsconfig.json (gitignored); tests fail to load without it
```

## File map

- `src/lib/config-codec.ts` *(modified)* — add chunk constants, `checksum`,
  `planStorage`, `parseManifest`, `reassembleConfig`; retarget `configStorageBytes`.
- `src/lib/config-codec.test.ts` *(modified)* — add chunk-layout, round-trip,
  torn-read, and cap tests.
- `src/lib/storage.ts` *(modified)* — chunk-aware `configStore` (batch read/write,
  orphan GC, coalescing debounce); re-export the new budget constants.
- `src/lib/storage.test.ts` *(new)* — facade tests over an in-memory `wxt/storage`
  mock: chunk round-trip, orphan GC on shrink, torn manifest → empty, old-peer
  overwrite adopted, write coalescing.
- `entrypoints/options/main.tsx` *(modified)* — near-quota threshold, banner copy,
  and `/quota/i` error copy retargeted to `CONFIG_SOFT_CAP_BYTES`.

Ordering: Task 1 (codec core) → Task 2 (byte accounting) → Task 3 (facade) →
Task 4 (UX) → Task 5 (gate). Everything depends on Task 1.

---

## Task 1 — Chunk codec core

### 1.1 — Failing tests

Add to `src/lib/config-codec.test.ts`. First extend the imports at the top:

```ts
import {
  serializeConfig,
  deserializeConfig,
  configStorageBytes,
  SYNC_ITEM_QUOTA_BYTES,
  CHUNK_PAYLOAD_BYTES,
  MAX_CONFIG_CHUNKS,
  CONFIG_SOFT_CAP_BYTES,
  checksum,
  planStorage,
  parseManifest,
  reassembleConfig,
} from "./config-codec";
```

Then append this suite:

```ts
// A config whose serialized blob is guaranteed to span multiple chunks: many
// profiles with a long, low-compressibility matcher value (random-ish hex).
function bigConfig(profileCount: number): Config {
  return {
    version: 1,
    masterEnabled: true,
    profiles: Array.from({ length: profileCount }, (_, i) => ({
      id: `p${i}`,
      name: `Profile ${i}`,
      enabled: true,
      matcher: { mode: "regex", value: Array.from({ length: 40 }, (_, j) => (i * 7 + j * 13).toString(16) + "abc123def").join("|") },
      rules: [{ id: `r${i}`, enabled: true, op: "set", name: "X-Auth", value: `token-${i}-${"z".repeat(30)}` }],
    })),
  };
}

describe("chunked storage (ADR-0005)", () => {
  it("checksum is deterministic and order-sensitive", () => {
    expect(checksum("abc")).toBe(checksum("abc"));
    expect(checksum("abc")).not.toBe(checksum("acb"));
    expect(checksum("")).toBe(checksum(""));
  });

  it("plans a small config as a single item", () => {
    const plan = planStorage(serializeConfig(sampleConfig(1)));
    expect(plan.kind).toBe("single");
    if (plan.kind === "single") expect(plan.value.startsWith("HHC1")).toBe(true);
  });

  it("plans a large config into <= MAX chunks with a matching manifest", () => {
    const blob = serializeConfig(bigConfig(60));
    const plan = planStorage(blob);
    expect(plan.kind).toBe("chunked");
    if (plan.kind !== "chunked") return;
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks.length).toBeLessThanOrEqual(MAX_CONFIG_CHUNKS);
    expect(plan.chunks.every((c) => c.length <= CHUNK_PAYLOAD_BYTES)).toBe(true);
    expect(plan.chunks.join("")).toBe(blob);
    const m = parseManifest(plan.manifest);
    expect(m).toEqual({ n: plan.chunks.length, len: blob.length, sum: checksum(blob) });
  });

  it("throws a quota-flavoured error above the soft cap", () => {
    // A blob past MAX_CONFIG_CHUNKS * CHUNK_PAYLOAD_BYTES cannot be planned.
    expect(() => planStorage("HHC1" + "x".repeat(CONFIG_SOFT_CAP_BYTES + 10))).toThrow(/quota/i);
  });

  it("parseManifest rejects non-manifest values", () => {
    expect(parseManifest("HHC1abc")).toBeNull();
    expect(parseManifest("random")).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest("HHM1{not json")).toBeNull();
  });

  it("round-trips a large config through plan -> reassemble", () => {
    const cfg = bigConfig(60);
    const plan = planStorage(serializeConfig(cfg));
    if (plan.kind !== "chunked") throw new Error("expected chunked");
    const m = parseManifest(plan.manifest)!;
    expect(reassembleConfig(m, plan.chunks)).toEqual(cfg);
  });

  it("reassemble falls back to empty on a missing chunk, wrong length, or bad checksum", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blob = serializeConfig(bigConfig(60));
    const plan = planStorage(blob);
    if (plan.kind !== "chunked") throw new Error("expected chunked");
    const m = parseManifest(plan.manifest)!;
    // Missing chunk (null in the slot).
    expect(reassembleConfig(m, [plan.chunks[0], null, ...plan.chunks.slice(2)])).toEqual(emptyConfig());
    // Wrong count.
    expect(reassembleConfig(m, plan.chunks.slice(0, m.n - 1))).toEqual(emptyConfig());
    // Corrupt content (same length, different bytes) → checksum mismatch.
    const corrupt = [...plan.chunks];
    corrupt[0] = "Z" + corrupt[0].slice(1);
    expect(reassembleConfig(m, corrupt)).toEqual(emptyConfig());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

Run — confirm failure (symbols not yet exported):

```bash
npm test -- src/lib/config-codec.test.ts
```

Expected: fails resolving `checksum`/`planStorage`/`parseManifest`/`reassembleConfig`.

### 1.2 — Implement

In `src/lib/config-codec.ts`, add below the existing `SYNC_ITEM_QUOTA_BYTES`
declaration:

```ts
// Total sync quota across all items (QUOTA_BYTES), and the chunking budget. A
// config too large for one 8 KB item (QUOTA_BYTES_PER_ITEM) is split across items
// keyed off a manifest at sync:config (ADR-0005). The soft cap sits well below the
// total quota to leave headroom for the manifest, write bursts, and future items.
export const SYNC_TOTAL_QUOTA_BYTES = 102400;
export const CHUNK_PAYLOAD_BYTES = 7168; // max chars per chunk slice
export const MAX_CONFIG_CHUNKS = 12;
export const CONFIG_SOFT_CAP_BYTES = MAX_CONFIG_CHUNKS * CHUNK_PAYLOAD_BYTES; // ~84 KB

const MANIFEST_MARKER = "HHM1";

export interface Manifest {
  n: number; // chunk count
  len: number; // reassembled blob length (chars == bytes; the blob is ASCII)
  sum: number; // checksum of the reassembled blob (torn-read detection)
}
```

Add these functions at the end of the file:

```ts
// Fast non-cryptographic string hash (cyrb53). For torn-read / corruption
// detection only — not security. Deterministic and order-sensitive.
export function checksum(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// The per-item quota counts the real chrome key length + JSON.stringify(value).
// sync:config's chrome key is "config" (6 bytes); the blob is ASCII so JSON adds
// exactly 2 quote bytes and no escapes.
function fitsOneItem(blob: string): boolean {
  return 6 + byteLength(blob) + 2 <= SYNC_ITEM_QUOTA_BYTES;
}

// Decide the on-disk layout for a serialized HHC1… blob. Throws a quota-flavoured
// error (surfaced by the Options /quota/i handler) when the blob needs more than
// MAX_CONFIG_CHUNKS chunks, so an over-cap save is rejected before any write.
export function planStorage(blob: string):
  | { kind: "single"; value: string }
  | { kind: "chunked"; chunks: string[]; manifest: string } {
  if (fitsOneItem(blob)) return { kind: "single", value: blob };
  const chunks: string[] = [];
  for (let i = 0; i < blob.length; i += CHUNK_PAYLOAD_BYTES) {
    chunks.push(blob.slice(i, i + CHUNK_PAYLOAD_BYTES));
  }
  if (chunks.length > MAX_CONFIG_CHUNKS) {
    throw new Error(
      `Config exceeds the sync-storage quota: needs ${chunks.length} chunks, max ${MAX_CONFIG_CHUNKS}.`,
    );
  }
  const manifest: Manifest = { n: chunks.length, len: blob.length, sum: checksum(blob) };
  return { kind: "chunked", chunks, manifest: MANIFEST_MARKER + JSON.stringify(manifest) };
}

// Parse a manifest value, or null if it isn't one (single-item HHC1…, legacy
// object, junk, null). A well-formed manifest has numeric n / len / sum.
export function parseManifest(value: unknown): Manifest | null {
  if (typeof value !== "string" || !value.startsWith(MANIFEST_MARKER)) return null;
  try {
    const m = JSON.parse(value.slice(MANIFEST_MARKER.length)) as Partial<Manifest>;
    if (typeof m?.n === "number" && typeof m.len === "number" && typeof m.sum === "number") {
      return { n: m.n, len: m.len, sum: m.sum };
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

// Validate the chunk set against its manifest, then decode. Any missing chunk,
// length mismatch, or checksum mismatch → emptyConfig() + warn, never a throw: a
// torn/partial read must not be parsed as a real config (mirrors deserializeConfig).
export function reassembleConfig(manifest: Manifest, chunkValues: (string | null | undefined)[]): Config {
  if (chunkValues.length !== manifest.n || chunkValues.some((c) => typeof c !== "string")) {
    console.warn("Header Handler: chunked config is missing chunks; using empty config");
    return emptyConfig();
  }
  const blob = (chunkValues as string[]).join("");
  if (blob.length !== manifest.len || checksum(blob) !== manifest.sum) {
    console.warn("Header Handler: chunked config failed validation (torn read); using empty config");
    return emptyConfig();
  }
  return deserializeConfig(blob);
}
```

Run — confirm the new suite passes:

```bash
npm test -- src/lib/config-codec.test.ts
```

Expected: all tests pass (existing compression suite + the new chunked suite).

### 1.3 — Commit

```bash
git add src/lib/config-codec.ts src/lib/config-codec.test.ts
git commit -m "feat: chunk-planning codec for oversized configs"
```

---

## Task 2 — Retarget byte accounting

### 2.1 — Update `configStorageBytes`

The near-quota UI now budgets against the ~84 KB total (payload) cap, not one
8 KB item. Measure the compressed blob's byte length — the payload that gets
sliced, defined in the same units as `CONFIG_SOFT_CAP_BYTES`.

In `src/lib/config-codec.ts`, replace the body of `configStorageBytes`:

```ts
export function configStorageBytes(cfg: Config): number {
  return byteLength(serializeConfig(cfg));
}
```

Update its doc comment to:

```ts
// Bytes the config's compressed payload occupies — what the Options near-quota UI
// budgets against CONFIG_SOFT_CAP_BYTES. Measured on the compressed blob (the
// thing that gets stored / sliced), not the raw JSON. Chunk key + JSON-quote
// overhead is small relative to the soft cap's headroom and is not counted.
```

### 2.2 — Verify existing accounting test still holds

The existing "compresses … under the raw JSON size" test asserts
`configStorageBytes(cfg) < SYNC_ITEM_QUOTA_BYTES` for an 8-profile config — still
true (a small config's blob is well under 8 KB). No test edit needed.

```bash
npm test -- src/lib/config-codec.test.ts
```

Expected: all pass.

### 2.3 — Commit

```bash
git add src/lib/config-codec.ts
git commit -m "refactor: measure config bytes against the total sync budget"
```

---

## Task 3 — Chunk-aware storage facade

### 3.1 — Failing tests

Create `src/lib/storage.test.ts`. It mocks `wxt/storage` with an in-memory
Map-backed store implementing exactly the methods the facade uses.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Config } from "../types";
import { emptyConfig } from "../types";

// In-memory wxt/storage mock. Keys are full "sync:…" strings. defineItem returns
// a thin get/set/watch bound to one key; getItems/setItems/removeItems are batch.
const mem = new Map<string, unknown>();
const watchers = new Map<string, Set<(v: unknown) => void>>();

function emit(key: string) {
  watchers.get(key)?.forEach((cb) => cb(mem.get(key) ?? null));
}

vi.mock("wxt/storage", () => ({
  storage: {
    defineItem: (key: string, opts: { fallback: unknown }) => ({
      getValue: async () => (mem.has(key) ? mem.get(key) : opts.fallback),
      setValue: async (v: unknown) => {
        mem.set(key, v);
        emit(key);
      },
      watch: (cb: (v: unknown) => void) => {
        const set = watchers.get(key) ?? new Set();
        set.add(cb);
        watchers.set(key, set);
        return () => set.delete(cb);
      },
    }),
    getItems: async (keys: string[]) => keys.map((key) => ({ key, value: mem.has(key) ? mem.get(key) : null })),
    setItems: async (items: { key: string; value: unknown }[]) => {
      for (const { key, value } of items) {
        mem.set(key, value);
        emit(key);
      }
    },
    removeItems: async (keys: string[]) => {
      for (const key of keys) {
        mem.delete(key);
        emit(key);
      }
    },
  },
}));

// Import AFTER the mock is registered.
import { configStore } from "./storage";
import { serializeConfig, parseManifest, MAX_CONFIG_CHUNKS } from "./config-codec";

function bigConfig(profileCount: number): Config {
  return {
    version: 1,
    masterEnabled: true,
    profiles: Array.from({ length: profileCount }, (_, i) => ({
      id: `p${i}`,
      name: `Profile ${i}`,
      enabled: true,
      matcher: { mode: "regex", value: Array.from({ length: 40 }, (_, j) => (i * 7 + j * 13).toString(16) + "abc123def").join("|") },
      rules: [{ id: `r${i}`, enabled: true, op: "set", name: "X-Auth", value: `token-${i}-${"z".repeat(30)}` }],
    })),
  };
}

// setValue coalesces on a 500ms trailing timer; drive it with fake timers.
async function saveNow(cfg: Config) {
  const p = configStore.setValue(cfg);
  await vi.advanceTimersByTimeAsync(500);
  await p;
}

describe("configStore chunking", () => {
  beforeEach(() => {
    mem.clear();
    watchers.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("stores a small config as a single HHC1 item and reads it back", async () => {
    const cfg: Config = { version: 1, masterEnabled: true, profiles: [] };
    await saveNow(cfg);
    expect((mem.get("sync:config") as string).startsWith("HHC1")).toBe(true);
    expect(mem.has("sync:config/0")).toBe(false);
    expect(await configStore.getValue()).toEqual(cfg);
  });

  it("stores a large config as a manifest + chunk items and reads it back", async () => {
    const cfg = bigConfig(60);
    await saveNow(cfg);
    const manifest = parseManifest(mem.get("sync:config"));
    expect(manifest).not.toBeNull();
    expect(manifest!.n).toBeGreaterThan(1);
    expect(mem.has(`sync:config/${manifest!.n - 1}`)).toBe(true);
    expect(await configStore.getValue()).toEqual(cfg);
  });

  it("garbage-collects orphan chunks when the config shrinks back to one item", async () => {
    await saveNow(bigConfig(60));
    const prevN = parseManifest(mem.get("sync:config"))!.n;
    await saveNow({ version: 1, masterEnabled: true, profiles: [] });
    expect((mem.get("sync:config") as string).startsWith("HHC1")).toBe(true);
    for (let i = 0; i < prevN; i++) expect(mem.has(`sync:config/${i}`)).toBe(false);
  });

  it("reads a torn manifest (missing chunk) as an empty config", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await saveNow(bigConfig(60));
    const n = parseManifest(mem.get("sync:config"))!.n;
    mem.delete(`sync:config/${n - 1}`); // lose the last chunk
    expect(await configStore.getValue()).toEqual(emptyConfig());
    warn.mockRestore();
  });

  it("adopts an old-peer single-item overwrite and GCs orphans on next write", async () => {
    await saveNow(bigConfig(60)); // account is chunked
    // Simulate an un-updated peer overwriting sync:config with a small HHC1 config.
    const peerCfg: Config = {
      version: 1,
      masterEnabled: true,
      profiles: [{ id: "x", name: "Peer", enabled: true, matcher: { mode: "contains", value: "a" }, rules: [] }],
    };
    mem.set("sync:config", serializeConfig(peerCfg));
    expect(await configStore.getValue()).toEqual(peerCfg); // authoritative
    // A subsequent local save GCs the orphan chunks (prevN read as 0 since sync:config is now HHC1).
    await saveNow(peerCfg);
    expect(mem.has("sync:config/0")).toBe(false);
  });

  it("coalesces a burst of saves into one write carrying the last value", async () => {
    const setItems = vi.spyOn(await import("wxt/storage").then((m) => m.storage), "setItems");
    const a: Config = { version: 1, masterEnabled: true, profiles: [] };
    const b: Config = { version: 1, masterEnabled: false, profiles: [] };
    const p1 = configStore.setValue(a);
    const p2 = configStore.setValue(b);
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all([p1, p2]);
    expect(await configStore.getValue()).toEqual(b); // last value wins
    setItems.mockRestore();
  });
});
```

Note: `MAX_CONFIG_CHUNKS` is imported to keep the assertion vocabulary aligned
with the codec even though only the round-trip needs it; remove the import if lint
flags it unused.

Run — confirm failure (facade not yet chunk-aware):

```bash
npm test -- src/lib/storage.test.ts
```

Expected: fails — the current facade writes only `sync:config` and never chunks.

### 3.2 — Implement the facade

Replace the top of `src/lib/storage.ts` (the imports, the re-export line, the
`rawConfigStore`, and the `configStore` object) with:

```ts
import { storage } from "wxt/storage";
import type { StorageItemKey } from "wxt/storage";
import type { Config } from "../types";
import {
  serializeConfig,
  deserializeConfig,
  parseManifest,
  reassembleConfig,
  planStorage,
} from "./config-codec";

// Config (de)serialization, the quota constants, and byte accounting live in
// ./config-codec, a WXT-free module unit-tested without a fake browser. Re-export
// the bits callers reach for here.
export {
  SYNC_ITEM_QUOTA_BYTES,
  SYNC_TOTAL_QUOTA_BYTES,
  CONFIG_SOFT_CAP_BYTES,
  configStorageBytes,
} from "./config-codec";

// A config that fits one 8 KB item is stored at sync:config as an HHC1… string
// (unchanged from the pre-chunking layout). A larger config is stored as a manifest
// (HHM1…) at sync:config plus chunk items sync:config/0..n-1 (ADR-0005). A legacy
// raw-object value still reads via deserializeConfig.
const CONFIG_KEY = "sync:config" as const;
const chunkKey = (i: number): StorageItemKey => `sync:config/${i}` as StorageItemKey;
const chunkKeys = (from: number, to: number): StorageItemKey[] => {
  const keys: StorageItemKey[] = [];
  for (let i = from; i < to; i++) keys.push(chunkKey(i));
  return keys;
};

const rawConfigStore = storage.defineItem<unknown>(CONFIG_KEY, { fallback: null });

async function readConfig(): Promise<Config> {
  const raw = await rawConfigStore.getValue();
  const manifest = parseManifest(raw);
  if (!manifest) return deserializeConfig(raw); // single-item HHC1 / legacy object / null
  const items = await storage.getItems(chunkKeys(0, manifest.n));
  return reassembleConfig(manifest, items.map((r) => r.value as string | null));
}

// How many chunk items the currently-stored config uses (0 if single/legacy/empty),
// so a write can garbage-collect the ones it no longer needs.
async function currentChunkCount(): Promise<number> {
  return parseManifest(await rawConfigStore.getValue())?.n ?? 0;
}

async function writeConfig(cfg: Config): Promise<void> {
  const plan = planStorage(serializeConfig(cfg)); // throws (quota) before any write if over cap
  const prevN = await currentChunkCount();

  if (plan.kind === "single") {
    await rawConfigStore.setValue(plan.value);
    if (prevN > 0) await storage.removeItems(chunkKeys(0, prevN));
    return;
  }
  // Chunked: write chunks first, GC surplus, then the manifest LAST so a reader
  // never sees a manifest pointing past the chunks that exist for it.
  await storage.setItems(plan.chunks.map((value, i) => ({ key: chunkKey(i), value })));
  if (prevN > plan.chunks.length) await storage.removeItems(chunkKeys(plan.chunks.length, prevN));
  await rawConfigStore.setValue(plan.manifest);
}

// Coalesce a burst of edits into one write: keep only the latest Config, flush on
// a trailing timer. Chunked writes multiply items, so this keeps saves well under
// MAX_WRITE_OPERATIONS_PER_HOUR (ADR-0005). Each caller's promise resolves when its
// value — or a newer one that superseded it — has been persisted.
const WRITE_DEBOUNCE_MS = 500;
let pending: { cfg: Config; resolve: () => void; reject: (e: unknown) => void }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  const batch = pending;
  pending = [];
  flushTimer = undefined;
  writeConfig(batch[batch.length - 1].cfg).then(
    () => batch.forEach((p) => p.resolve()),
    (e) => batch.forEach((p) => p.reject(e)),
  );
}

function coalesceWrite(cfg: Config): Promise<void> {
  return new Promise((resolve, reject) => {
    pending.push({ cfg, resolve, reject });
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, WRITE_DEBOUNCE_MS);
  });
}

export const configStore = {
  getValue: readConfig,
  setValue: coalesceWrite,
  watch: (cb: (cfg: Config) => void): (() => void) =>
    rawConfigStore.watch(() => {
      void readConfig().then(cb);
    }),
};
```

Leave the `LogEntry` / `logStore` / `DnrError` / `dnrErrorStore` declarations below
this block untouched.

Run — confirm the facade suite passes:

```bash
npm test -- src/lib/storage.test.ts
```

Expected: all pass.

### 3.3 — Commit

```bash
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat: chunk-aware config store with debounced multi-item writes"
```

---

## Task 4 — Options UX retarget

All four edits are in `entrypoints/options/main.tsx`.

### 4.1 — Import the new budget constant

Replace:

```tsx
import { configStore, dnrErrorStore, SYNC_ITEM_QUOTA_BYTES, configStorageBytes, type DnrError } from "../../src/lib/storage";
```

with:

```tsx
import { configStore, dnrErrorStore, CONFIG_SOFT_CAP_BYTES, configStorageBytes, type DnrError } from "../../src/lib/storage";
```

### 4.2 — Retarget the save-error copy

Replace:

```tsx
  if (/quota/i.test(msg)) {
    return "Config is too large to save — it's over Chrome's 8 KB sync-storage limit. Shrink or remove some rules or values, then edit again.";
  }
```

with:

```tsx
  if (/quota/i.test(msg)) {
    return "Config is too large to sync — it's over Chrome's ~84 KB sync-storage budget. Remove some profiles or rules, then edit again.";
  }
```

### 4.3 — Retarget the near-quota threshold

Replace:

```tsx
  const configBytes = configStorageBytes(cfg);
  const nearQuota = !saveError && configBytes >= SYNC_ITEM_QUOTA_BYTES * 0.8;
```

with:

```tsx
  const configBytes = configStorageBytes(cfg);
  const nearQuota = !saveError && configBytes >= CONFIG_SOFT_CAP_BYTES * 0.8;
```

### 4.4 — Retarget the banner copy

Replace:

```tsx
          <span>
            This config compresses to {configBytes.toLocaleString()} bytes, near Chrome's {SYNC_ITEM_QUOTA_BYTES.toLocaleString()}
            -byte sync limit. Saves will start failing if it grows much larger.
          </span>
```

with:

```tsx
          <span>
            This config uses {configBytes.toLocaleString()} of Chrome's {CONFIG_SOFT_CAP_BYTES.toLocaleString()}
            -byte sync-storage budget. Saves will start failing if it grows much larger.
          </span>
```

### 4.5 — Verify and commit

```bash
npx wxt prepare && npm run build
```

Expected: the extension builds without type errors (`SYNC_ITEM_QUOTA_BYTES` is no
longer referenced in `main.tsx`; it is still exported for any other consumer).

```bash
git add entrypoints/options/main.tsx
git commit -m "feat: budget the options near-quota UI against the total sync limit"
```

---

## Task 5 — Full gate

```bash
npx wxt prepare
npm test
npm run build
npm run build:pages
```

Expected: the whole vitest suite passes (including the new codec and storage
suites); both builds succeed. This mirrors CI (`.github/workflows/ci.yml`).

Manual smoke (optional, real browser): load the built extension, import a large
ModHeader export via the converter → Import, confirm it saves (pill shows Saved,
not Save failed), reload the options page, and confirm all profiles round-trip.
Inspect `chrome.storage.sync` in DevTools → `sync:config` is an `HHM1…` manifest
with `sync:config/0..n` chunk items alongside it.

---

## Self-review

- **Spec coverage:** Task 1 implements `planStorage` / `parseManifest` /
  `reassembleConfig` / `checksum` / the constants and the manifest format (spec
  §"Storage layout", §"Byte budget", §"config-codec.ts"). Task 2 retargets
  `configStorageBytes` (spec §"UX changes"). Task 3 implements the facade:
  manifest-last write ordering, orphan GC, batch read/write, coalescing debounce,
  torn-read fallback, and old-peer adoption (spec §"storage.ts", §"Write path",
  §"Cross-version coexistence"; ADR-0006). Task 4 covers every `main.tsx` UX line
  in the spec. Lazy migration needs no task — it *is* the ordinary read/write path
  (spec §"Migration"). Out-of-scope items (slice-diff, active guards,
  storage.local, per-profile) are implemented nowhere, as intended.
- **Type consistency:** `Manifest { n; len; sum }`, `planStorage(blob) ->
  { kind:"single"; value } | { kind:"chunked"; chunks; manifest }`,
  `parseManifest(value) -> Manifest | null`, `reassembleConfig(manifest,
  chunkValues) -> Config`, and `checksum(s) -> number` are identical across the
  codec, its tests, the facade, and the facade tests. Chunk keys are
  `sync:config/${i}` everywhere; the entry key is `sync:config`.
- **Placeholder scan:** no `TBD`/`TODO`/"similar to"; every task has exact paths,
  full code blocks, and exact commands with expected output.
- **Proprietary data:** tests use synthetic configs only; no real ModHeader export
  is written to the repo.
