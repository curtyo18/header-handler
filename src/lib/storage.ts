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
