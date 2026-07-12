import type { Config, Matcher } from "../types";
import { matcherToDnrCondition, isMatchMode } from "./matcher";

// A matcher with an empty value has no valid DNR representation (empty urlFilter/
// regexFilter/requestDomains entry is rejected by chrome.declarativeNetRequest) —
// skip it rather than emit a condition that would throw and drop the whole
// updateDynamicRules batch.
function hasEmptyValue(m: Matcher): boolean {
  return m.value.trim() === "";
}

// HTTP header values can't contain raw CR/LF — DNR rejects the whole batch if
// one does. The plain-text value field is a <textarea>, so a pasted/typed
// newline is reachable; strip it here as the authoritative guard (imported
// values pass through here too, not just the editor). Issue #4.
export function sanitizeHeaderValue(v: string): string {
  return v.replace(/[\r\n]+/g, "");
}

// When a condition omits resourceTypes, DNR matches every resource type EXCEPT
// main_frame — so a header rule would silently skip the top-level page navigation
// while still applying to its sub-resources (scripts, XHR, …). Enumerate every
// type so "modify headers for this URL" covers the document request too.
const ALL_RESOURCE_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object",
  "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport",
  "webbundle", "other",
] as chrome.declarativeNetRequest.ResourceType[];

// DNR needs integer ids; derive them deterministically from position so the same
// config always compiles to the same id set (stable diffing across worker restarts).
export function compileRules(cfg: Config): chrome.declarativeNetRequest.Rule[] {
  if (!cfg.masterEnabled) return [];
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  let id = 1;
  cfg.profiles.forEach((profile, pIdx) => {
    if (!profile.enabled) return;
    for (const rule of profile.rules) {
      if (!rule.enabled) continue;
      if (rule.name.trim() === "") continue;
      const matcher = rule.matcher ?? profile.matcher;
      // An unrecognized mode (only reachable via a hand-crafted decoded share)
      // has no valid condition and would otherwise throw here and drop the whole
      // batch, or worse compile to a match-all condition — skip it.
      if (!matcher || !isMatchMode(matcher.mode)) continue;
      if (hasEmptyValue(matcher)) continue;
      const cond = matcherToDnrCondition(matcher);
      rules.push({
        id: id++,
        priority: 1 + pIdx,
        action: {
          type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [{
            header: rule.name.toLowerCase(),
            operation: (rule.op === "set" ? "set" : "remove") as chrome.declarativeNetRequest.HeaderOperation,
            ...(rule.op === "set" ? { value: sanitizeHeaderValue(rule.value ?? "") } : {}),
          }],
        },
        condition: { ...cond, resourceTypes: ALL_RESOURCE_TYPES },
      });
    }
  });
  return rules;
}

export function diffRules(
  current: chrome.declarativeNetRequest.Rule[],
  next: chrome.declarativeNetRequest.Rule[],
): { addRules: chrome.declarativeNetRequest.Rule[]; removeRuleIds: number[] } {
  const curById = new Map(current.map((r) => [r.id, r]));
  const nextIds = new Set(next.map((r) => r.id));
  // An id present in both isn't necessarily the same rule: ids are derived from
  // array position, so unrelated rules can collide on id across recompiles.
  // Compare content, not just id membership, or a changed rule silently never reaches DNR.
  const addRules = next.filter((r) => {
    const cur = curById.get(r.id);
    return !cur || JSON.stringify(cur) !== JSON.stringify(r);
  });
  const removeRuleIds = current
    .filter((r) => !nextIds.has(r.id) || addRules.some((a) => a.id === r.id))
    .map((r) => r.id);
  return { addRules, removeRuleIds };
}

type UpdateArg = { addRules?: chrome.declarativeNetRequest.Rule[]; removeRuleIds?: number[] };

// updateDynamicRules is atomic: one rule DNR rejects (an RE2-unsupported regex,
// a value/domain that slipped past validation) drops the ENTIRE batch and leaves
// header rewriting silently broken for every profile. So on a batch failure,
// remove the stale ids, then re-add survivors one at a time and report which
// rules DNR refused — one bad rule can no longer disable all the others (#4).
export async function applyRulesWithFallback(
  addRules: chrome.declarativeNetRequest.Rule[],
  removeRuleIds: number[],
  apply: (u: UpdateArg) => Promise<void>,
): Promise<chrome.declarativeNetRequest.Rule[]> {
  try {
    await apply({ addRules, removeRuleIds });
    return [];
  } catch {
    // Removes are always valid; apply them so obsolete rules don't linger.
    await apply({ removeRuleIds }).catch(() => {});
    const failed: chrome.declarativeNetRequest.Rule[] = [];
    for (const r of addRules) {
      try {
        await apply({ addRules: [r] });
      } catch {
        failed.push(r);
      }
    }
    return failed;
  }
}
