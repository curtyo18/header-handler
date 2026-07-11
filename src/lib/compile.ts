import type { Config } from "../types";
import { matcherToDnrCondition } from "./matcher";

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
      const cond = matcherToDnrCondition(rule.matcher ?? profile.matcher);
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
  const nextIds = new Set(next.map((r) => r.id));
  const curIds = new Set(current.map((r) => r.id));
  return {
    removeRuleIds: current.filter((r) => !nextIds.has(r.id)).map((r) => r.id),
    addRules: next.filter((r) => !curIds.has(r.id)),
  };
}
