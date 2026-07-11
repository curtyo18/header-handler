import { describe, it, expect } from "vitest";
import { compileRules, diffRules } from "./compile";
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
    expect(set.condition).toEqual({ requestDomains: ["example.com"] });
    const rm = rules.find((r) => r.action.requestHeaders?.[0].header === "cookie")!;
    expect(rm.action.requestHeaders![0].operation).toBe("remove");
    expect(rm.action.requestHeaders![0].value).toBeUndefined();
  });
  it("uses per-rule matcher over profile matcher when present", () => {
    const c = structuredClone(cfg);
    c.profiles[0].rules[0].matcher = { mode: "contains", value: "/api" };
    expect(compileRules(c)[0].condition).toEqual({ urlFilter: "/api" });
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
