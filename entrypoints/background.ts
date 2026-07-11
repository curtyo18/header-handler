import { configStore, logStore, LOG_CAP, type LogEntry } from "../src/lib/storage";
import { compileRules, diffRules } from "../src/lib/compile";
import { evaluateMatcher } from "../src/lib/matcher";
import type { Config } from "../src/types";

export default defineBackground(() => {
  async function recompile() {
    const cfg = await configStore.getValue();
    const next = compileRules(cfg);
    const current = await chrome.declarativeNetRequest.getDynamicRules();
    const { addRules, removeRuleIds } = diffRules(current, next);
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ addRules, removeRuleIds });
    } catch (e) {
      console.error("DNR update failed", e);
    }
  }

  configStore.watch(recompile);
  chrome.runtime.onInstalled.addListener(recompile);
  chrome.runtime.onStartup.addListener(recompile);
  recompile();

  // Open the side panel from the popup button.
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === "open-panel" && sender.tab?.windowId != null) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId });
    }
  });

  // Live-log reconstruction (see ADR 0001): observe requests, re-run the matcher.
  function matchedRules(cfg: Config, url: string): string[] {
    if (!cfg.masterEnabled) return [];
    const hits: string[] = [];
    for (const p of cfg.profiles) {
      if (!p.enabled) continue;
      for (const r of p.rules) {
        if (!r.enabled) continue;
        if (evaluateMatcher(r.matcher ?? p.matcher, url)) hits.push(`${p.id}:${r.id}`);
      }
    }
    return hits;
  }

  chrome.webRequest.onSendHeaders.addListener(
    async (details) => {
      const cfg = await configStore.getValue();
      const matched = matchedRules(cfg, details.url);
      if (matched.length === 0) return;
      const entry: LogEntry = {
        ts: Date.now(),
        method: details.method,
        url: details.url,
        requestHeaders: (details.requestHeaders ?? []).map((h) => ({
          name: h.name, value: h.value ?? "",
        })),
        matchedRuleIds: matched,
      };
      const log = await logStore.getValue();
      await logStore.setValue([entry, ...log].slice(0, LOG_CAP));
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders", "extraHeaders"],
  );
});
