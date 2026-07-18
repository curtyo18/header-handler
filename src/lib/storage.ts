import { storage } from "wxt/storage";
import type { StorageItemKey } from "wxt/storage";
import type { Config } from "../types";
import {
  serializeConfig,
  deserializeConfig,
  parseManifest,
  reassembleConfig,
  planStorage,
  MAX_CONFIG_CHUNKS,
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

// Chunk keys physically present, up to the max a manifest could ever reference.
// Probing storage directly (rather than trusting the current manifest at
// sync:config) matters because a pre-chunking peer can overwrite sync:config with
// a bare single-item value without touching sync:config/0..n-1 — the manifest that
// would tell us "n" is gone, but the orphaned chunk items are still there to GC.
async function existingChunkKeys(): Promise<StorageItemKey[]> {
  const items = await storage.getItems(chunkKeys(0, MAX_CONFIG_CHUNKS));
  return items.filter((it) => it.value != null).map((it) => it.key as StorageItemKey);
}

async function writeConfig(cfg: Config): Promise<void> {
  const plan = planStorage(serializeConfig(cfg)); // throws (quota) before any write if over cap
  const existing = await existingChunkKeys();

  if (plan.kind === "single") {
    await rawConfigStore.setValue(plan.value);
    if (existing.length > 0) await storage.removeItems(existing);
    return;
  }
  // Chunked: write chunks, then the manifest, then GC orphans. Manifest-after-chunks
  // means a reader never sees a manifest referencing a chunk not yet written.
  // GC-after-manifest means a crash before GC leaves only unreferenced orphan chunks
  // (harmless — the next write's existingChunkKeys() sweeps them) rather than a
  // manifest pointing at already-deleted chunks (which would read as a torn/empty
  // config until the next successful save). This mirrors the single-item path above,
  // which also writes the authoritative value before removing the old chunks.
  await storage.setItems(plan.chunks.map((value, i) => ({ key: chunkKey(i), value })));
  await rawConfigStore.setValue(plan.manifest);
  const needed = new Set(chunkKeys(0, plan.chunks.length));
  const orphans = existing.filter((k) => !needed.has(k));
  if (orphans.length > 0) await storage.removeItems(orphans);
}

// Coalesce a burst of edits into one write: keep only the latest Config, flush on
// a trailing timer. Chunked writes multiply items, so this keeps saves well under
// MAX_WRITE_OPERATIONS_PER_HOUR (ADR-0005). Each caller's promise resolves when its
// value — or a newer one that superseded it — has been persisted.
const WRITE_DEBOUNCE_MS = 500;
let pending: { cfg: Config; resolve: () => void; reject: (e: unknown) => void }[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
// Serializes flushes: each write runs only after the previous one has settled, so
// two multi-item writes never interleave (an interleaving could land a manifest
// pointing at chunks a later write already deleted → torn read → silent reset).
let writeChain: Promise<void> = Promise.resolve();

function flush() {
  const batch = pending;
  pending = [];
  flushTimer = undefined;
  const cfg = batch[batch.length - 1].cfg;
  const run = writeChain.catch(() => {}).then(() => writeConfig(cfg));
  writeChain = run.catch(() => {}); // next flush waits for this write to settle, success or fail
  run.then(
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
    rawConfigStore.watch((raw) => {
      void readConfig().then((cfg) => {
        // Guard against a torn cross-key sync: chrome.storage.sync propagates keys
        // independently with no ordering, so a remote device's chunked save can
        // deliver its manifest before its chunks. The watch fires on the manifest
        // key, readConfig reassembles with chunks still missing → emptyConfig(), and
        // the chunk keys aren't watched so no later event re-fires. An empty config
        // is never stored as a manifest (it fits one item), so "manifest present +
        // empty reassembly" is unambiguously that transient torn read — skip it
        // rather than deliver a false empty a subsequent edit could persist over the
        // good config (ADR-0006). A reload or the next manifest write reads cleanly.
        if (cfg.profiles.length === 0 && parseManifest(raw)) return;
        cb(cfg);
      });
    }),
};

export interface LogEntry {
  id: string; // stable unique key; two requests can share a ts (parallel subresources)
  ts: number;
  method: string;
  url: string;
  requestHeaders: { name: string; value: string }[];
  matchedRuleIds: string[]; // "profileId:ruleId"
}

// Session-only ring buffer; cleared on browser close.
export const logStore = storage.defineItem<LogEntry[]>("session:log", { fallback: [] });
export const LOG_CAP = 500;

// Surfaces a declarativeNetRequest.updateDynamicRules rejection to the options UI
// so a failed apply is never invisible (issue #4). Session-scoped: a failure is
// only meaningful for the current run of the worker/rules.
export interface DnrError {
  count: number; // rules DNR refused to apply
  message: string; // the DNR error text
}
export const dnrErrorStore = storage.defineItem<DnrError | null>("session:dnrError", {
  fallback: null,
});
