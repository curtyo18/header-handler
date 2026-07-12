import { configStore, logStore, LOG_CAP, type LogEntry } from "../src/lib/storage";
import { compileRules, diffRules } from "../src/lib/compile";
import { matchedRules, matchedProfileCount } from "../src/lib/matches";

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

  // Badge: count of distinct enabled profiles with a rule matching the active tab's URL.
  // Tabs can close between an event firing and these calls running, so every chrome.*
  // call here is wrapped the same way recompile() wraps its DNR call above.
  async function updateBadge(tabId: number, url: string | undefined) {
    try {
      const cfg = await configStore.getValue();
      const count = url ? matchedProfileCount(cfg, url) : 0;
      await chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" });
    } catch (e) {
      console.error("Badge update failed", e);
    }
  }

  async function updateAllBadges() {
    try {
      const tabs = await chrome.tabs.query({});
      await Promise.all(tabs.filter((t) => t.id != null).map((t) => updateBadge(t.id!, t.url)));
    } catch (e) {
      console.error("Badge update failed", e);
    }
  }

  chrome.action.setBadgeBackgroundColor({ color: "#6ea8fe" });
  configStore.watch(updateAllBadges);
  chrome.runtime.onInstalled.addListener(updateAllBadges);
  chrome.runtime.onStartup.addListener(updateAllBadges);

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      await updateBadge(tabId, tab.url);
    } catch (e) {
      console.error("Badge update failed", e);
    }
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) updateBadge(tabId, changeInfo.url);
    else if (changeInfo.status === "complete") updateBadge(tabId, tab.url);
  });
});
