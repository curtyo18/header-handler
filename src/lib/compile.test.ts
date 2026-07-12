import { describe, it, expect } from "vitest";
import { compileRules, diffRules, applyRulesWithFallback } from "./compile";
import type { Config } from "../types";

const cfg: Config = {
  version: 1, masterEnabled: true,
  profiles: [{
    id: "p1", name: "A", enabled: true,
    matcher: { mode: "domain", value: "example.com" },
    rules: [
      { id: "r1", enabled: true, op: "set", name: "X-A", value: "1" },
      { id: "r2", enabled: false, op: "set", name: "X-Off", value: "2" },
      { id: "r3", enabled: true, op: "remove", name: "Cookie" },
    ],
  }],
};

describe("compileRules", () => {
  it("emits one rule per enabled header rule with modifyHeaders action", () => {
    const rules = compileRules(cfg);
    expect(rules).toHaveLength(2);
    const set = rules.find((r) => r.action.requestHeaders?.[0].header === "x-a")!;
    expect(set.action.requestHeaders![0].operation).toBe("set");
    expect(set.action.requestHeaders![0].value).toBe("1");
    expect(set.condition).toMatchObject({ requestDomains: ["example.com"] });
    const rm = rules.find((r) => r.action.requestHeaders?.[0].header === "cookie")!;
    expect(rm.action.requestHeaders![0].operation).toBe("remove");
    expect(rm.action.requestHeaders![0].value).toBeUndefined();
  });
  it("uses per-rule matcher over profile matcher when present", () => {
    const c = structuredClone(cfg);
    c.profiles[0].rules[0].matcher = { mode: "contains", value: "/api" };
    expect(compileRules(c)[0].condition).toMatchObject({ urlFilter: "/api" });
  });
  it("includes main_frame in resourceTypes so top-level page navigations get headers", () => {
    // DNR excludes main_frame when resourceTypes is omitted; without this the
    // header applies to a page's sub-resources but not the document request itself.
    for (const rule of compileRules(cfg)) {
      expect(rule.condition.resourceTypes).toContain("main_frame");
    }
  });
  it("returns [] when master disabled", () => {
    expect(compileRules({ ...cfg, masterEnabled: false })).toEqual([]);
  });
  it("priority increases with profile index", () => {
    const two = structuredClone(cfg);
    two.profiles.push({ ...cfg.profiles[0], id: "p2" });
    const rules = compileRules(two);
    expect(rules.find((r) => r.priority === 1)).toBeTruthy();
    expect(rules.find((r) => r.priority === 2)).toBeTruthy();
  });
  it("skips a rule whose effective matcher has an empty value instead of emitting an invalid DNR condition", () => {
    const c = structuredClone(cfg);
    c.profiles[0].rules[0].matcher = { mode: "contains", value: "" };
    const rules = compileRules(c);
    expect(rules.find((r) => r.action.requestHeaders?.[0].header === "x-a")).toBeUndefined();
    expect(rules).toHaveLength(1); // only the Cookie-remove rule remains
  });
  it("skips an empty-value domain matcher too (empty requestDomains entry is just as invalid)", () => {
    const c = structuredClone(cfg);
    c.profiles[0].rules[0].matcher = { mode: "domain", value: "" };
    const rules = compileRules(c);
    expect(rules.find((r) => r.action.requestHeaders?.[0].header === "x-a")).toBeUndefined();
    expect(rules).toHaveLength(1);
  });
  it("skips a rule with a blank header name (DNR rejects an empty header field)", () => {
    const c = structuredClone(cfg);
    c.profiles[0].rules[0].name = "  ";
    const rules = compileRules(c);
    expect(rules.find((r) => r.action.requestHeaders?.[0].header === "x-a")).toBeUndefined();
    expect(rules).toHaveLength(1);
  });
  it("strips CR/LF from a set value (raw newlines make DNR reject the whole batch)", () => {
    const c = structuredClone(cfg);
    c.profiles[0].rules[0].value = "a\r\nb\nc";
    const set = compileRules(c).find((r) => r.action.requestHeaders?.[0].header === "x-a")!;
    expect(set.action.requestHeaders![0].value).toBe("abc");
  });
  it("skips an unknown-mode matcher (hand-crafted import) instead of throwing or match-all", () => {
    const c = structuredClone(cfg);
    (c.profiles[0].rules[0] as { matcher?: unknown }).matcher = { mode: "evil", value: "x" };
    const rules = compileRules(c);
    expect(rules.find((r) => r.action.requestHeaders?.[0].header === "x-a")).toBeUndefined();
    expect(rules).toHaveLength(1);
  });
});

describe("applyRulesWithFallback", () => {
  const rule = (id: number) => ({ id }) as chrome.declarativeNetRequest.Rule;

  it("applies the batch in one call when it succeeds", async () => {
    const calls: unknown[] = [];
    const failed = await applyRulesWithFallback([rule(1), rule(2)], [9], async (u) => {
      calls.push(u);
    });
    expect(failed).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("falls back to per-rule adds and reports only the rules DNR refuses", async () => {
    // First (batch) call throws; then removes succeed; then re-add rule 2 fails.
    const apply = async (u: { addRules?: { id: number }[]; removeRuleIds?: number[] }) => {
      if (u.addRules && u.addRules.length > 1) throw new Error("atomic batch rejected");
      if (u.addRules?.[0]?.id === 2) throw new Error("bad rule");
    };
    const failed = await applyRulesWithFallback([rule(1), rule(2), rule(3)], [9], apply);
    expect(failed.map((r) => r.id)).toEqual([2]);
  });
});

describe("diffRules", () => {
  it("computes add/remove deltas by id", () => {
    const current = [{ id: 1 }, { id: 2 }] as chrome.declarativeNetRequest.Rule[];
    const next = [{ id: 2 }, { id: 3 }] as chrome.declarativeNetRequest.Rule[];
    const { addRules, removeRuleIds } = diffRules(current, next);
    expect(removeRuleIds).toEqual([1]);
    expect(addRules.map((r) => r.id)).toEqual([3]);
  });
  it("re-adds a rule whose id is reused by different content (position-derived ids can collide)", () => {
    const current = [
      { id: 1, condition: { urlFilter: "old.com" } },
    ] as chrome.declarativeNetRequest.Rule[];
    const next = [
      { id: 1, condition: { urlFilter: "new.com" } },
    ] as chrome.declarativeNetRequest.Rule[];
    const { addRules, removeRuleIds } = diffRules(current, next);
    expect(removeRuleIds).toEqual([1]);
    expect(addRules).toEqual(next);
  });
  it("leaves an unchanged same-id rule alone", () => {
    const current = [{ id: 1, condition: { urlFilter: "x.com" } }] as chrome.declarativeNetRequest.Rule[];
    const next = [{ id: 1, condition: { urlFilter: "x.com" } }] as chrome.declarativeNetRequest.Rule[];
    const { addRules, removeRuleIds } = diffRules(current, next);
    expect(addRules).toEqual([]);
    expect(removeRuleIds).toEqual([]);
  });
});
