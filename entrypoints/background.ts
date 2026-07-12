import { configStore, logStore, dnrErrorStore, LOG_CAP, type LogEntry } from "../src/lib/storage";
import { compileRules, diffRules, applyRulesWithFallback } from "../src/lib/compile";
import { matchedRules, matchedProfileCount } from "../src/lib/matches";

export default defineBackground(() => {
  async function recompile() {
    const cfg = await configStore.getValue();
    const next = compileRules(cfg);
    const current = await chrome.declarativeNetRequest.getDynamicRules();
    const { addRules, removeRuleIds } = diffRules(current, next);
    let lastError = "";
    const failed = await applyRulesWithFallback(addRules, removeRuleIds, (u) =>
      chrome.declarativeNetRequest.updateDynamicRules(u).catch((e) => {
        lastError = e instanceof Error ? e.message : String(e);
        throw e;
      }),
    );
    // Surface any rules DNR refused so the failure isn't invisible (was console.error only).
    await dnrErrorStore.setValue(
      failed.length > 0 ? { count: failed.length, message: lastError } : null,
    );
  }

  configStore.watch(recompile);
  chrome.runtime.onInstalled.addListener(recompile);
  chrome.runtime.onStartup.addListener(recompile);
  recompile();

  // Serialize log writes through a single chained promise: the listener does a
  // read-modify-write on the log store, and concurrent requests (parallel
  // subresources) would otherwise interleave getValue/setValue and clobber each
  // other's entries. Chaining makes each append atomic w.r.t. the others (#8).
  let logWrite: Promise<void> = Promise.resolve();
  function appendLog(entry: LogEntry) {
    logWrite = logWrite.then(async () => {
      const log = await logStore.getValue();
      await logStore.setValue([entry, ...log].slice(0, LOG_CAP));
    });
    return logWrite;
  }

  chrome.webRequest.onSendHeaders.addListener(
    async (details) => {
      const cfg = await configStore.getValue();
      const matched = matchedRules(cfg, details.url);
      if (matched.length === 0) return;
      const entry: LogEntry = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        method: details.method,
        url: details.url,
        requestHeaders: (details.requestHeaders ?? []).map((h) => ({
          name: h.name, value: h.value ?? "",
        })),
        matchedRuleIds: matched,
      };
      await appendLog(entry);
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
