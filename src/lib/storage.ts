import { storage } from "wxt/storage";
import type { Config } from "../types";
import { emptyConfig } from "../types";

export const configStore = storage.defineItem<Config>("sync:config", {
  fallback: emptyConfig(),
});

export interface LogEntry {
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
