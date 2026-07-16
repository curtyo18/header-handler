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
  // Chunked: write chunks first, GC surplus, then the manifest LAST so a reader
  // never sees a manifest pointing past the chunks that exist for it.
  await storage.setItems(plan.chunks.map((value, i) => ({ key: chunkKey(i), value })));
  const needed = new Set(chunkKeys(0, plan.chunks.length));
  const orphans = existing.filter((k) => !needed.has(k));
  if (orphans.length > 0) await storage.removeItems(orphans);
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
