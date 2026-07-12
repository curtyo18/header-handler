import { describe, it, expect } from "vitest";
import { matchedRules, matchedProfileCount } from "./matches";
import type { Config } from "../types";

const cfg: Config = {
  version: 1, masterEnabled: true,
  profiles: [
    {
      id: "p1", name: "A", enabled: true,
      matcher: { mode: "domain", value: "example.com" },
      rules: [
        { id: "r1", enabled: true, op: "set", name: "X-A", value: "1" },
        { id: "r2", enabled: false, op: "set", name: "X-Off", value: "2" },
        { id: "r3", enabled: true, op: "set", name: "X-B", value: "3" },
      ],
    },
    {
      id: "p2", name: "B", enabled: true,
      matcher: { mode: "domain", value: "other.com" },
      rules: [{ id: "r4", enabled: true, op: "set", name: "X-C", value: "1" }],
    },
    {
      id: "p3", name: "C (disabled)", enabled: false,
      matcher: { mode: "domain", value: "example.com" },
      rules: [{ id: "r5", enabled: true, op: "set", name: "X-D", value: "1" }],
    },
  ],
};

describe("matchedRules", () => {
  it("returns profileId:ruleId for each enabled rule matching the URL", () => {
    expect(matchedRules(cfg, "https://example.com/x")).toEqual(["p1:r1", "p1:r3"]);
  });

  it("skips disabled rules and disabled profiles", () => {
    expect(matchedRules(cfg, "https://example.com/x")).not.toContain("p1:r2");
    expect(matchedRules(cfg, "https://example.com/x")).not.toContain("p3:r5");
  });

  it("returns nothing when the master switch is off", () => {
    expect(matchedRules({ ...cfg, masterEnabled: false }, "https://example.com/x")).toEqual([]);
  });

  it("returns nothing for a non-matching URL", () => {
    expect(matchedRules(cfg, "https://unrelated.com/x")).toEqual([]);
  });
});

describe("matchedProfileCount", () => {
  it("counts distinct profiles, not rules", () => {
    expect(matchedProfileCount(cfg, "https://example.com/x")).toBe(1);
  });

  it("counts each matching profile once across multiple profiles", () => {
    const both: Config = {
      ...cfg,
      profiles: [
        cfg.profiles[0],
        { ...cfg.profiles[1], matcher: { mode: "domain", value: "example.com" } },
      ],
    };
    expect(matchedProfileCount(both, "https://example.com/x")).toBe(2);
  });

  it("is 0 when master switch is off", () => {
    expect(matchedProfileCount({ ...cfg, masterEnabled: false }, "https://example.com/x")).toBe(0);
  });
});
