import type { Config, Matcher } from "../types";
import { matcherToDnrCondition } from "./matcher";

// A matcher with an empty value has no valid DNR representation (empty urlFilter/
// regexFilter/requestDomains entry is rejected by chrome.declarativeNetRequest) —
// skip it rather than emit a condition that would throw and drop the whole
// updateDynamicRules batch.
function hasEmptyValue(m: Matcher): boolean {
  return m.value.trim() === "";
}

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
            ...(rule.op === "set" ? { value: rule.value ?? "" } : {}),
          }],
        },
        condition: cond,
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
