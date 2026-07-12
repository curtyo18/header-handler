import { evaluateMatcher } from "./matcher";
import type { Config } from "../types";

// Live-log reconstruction (see ADR 0001): observe requests, re-run the matcher.
// Also the basis for the toolbar badge count (matchedProfileCount below) — one
// source of truth for "which rules apply to this URL" shared by both features.
export function matchedRules(cfg: Config, url: string): string[] {
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

export function matchedProfileCount(cfg: Config, url: string): number {
  return new Set(matchedRules(cfg, url).map((id) => id.split(":")[0])).size;
}
