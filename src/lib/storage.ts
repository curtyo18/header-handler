import { storage } from "wxt/storage";
import type { Config } from "../types";
import { serializeConfig, deserializeConfig } from "./config-codec";

// Config (de)serialization — LZString compression at rest, the quota constant, and
// the byte accounting — lives in ./config-codec, a WXT-free module so it can be
// unit-tested without a fake browser. Re-export the bits callers reach for here.
export { SYNC_ITEM_QUOTA_BYTES, configStorageBytes } from "./config-codec";

// Stored as an opaque compressed string; the facade below hides (de)serialization
// so callers keep the same Config-typed get/set/watch surface as before compression
// (issue #12). A legacy raw-object value still reads via deserializeConfig.
const rawConfigStore = storage.defineItem<unknown>("sync:config", { fallback: null });

export const configStore = {
  getValue: async (): Promise<Config> => deserializeConfig(await rawConfigStore.getValue()),
  setValue: (cfg: Config): Promise<void> => rawConfigStore.setValue(serializeConfig(cfg)),
  watch: (cb: (cfg: Config) => void): (() => void) =>
    rawConfigStore.watch((raw) => cb(deserializeConfig(raw))),
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
