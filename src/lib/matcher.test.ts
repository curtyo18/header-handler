import { describe, it, expect } from "vitest";
import { matcherToDnrCondition, evaluateMatcher, escapeUrlFilter, normalizeDomain } from "./matcher";

describe("escapeUrlFilter", () => {
  it("escapes DNR anchor/wildcard chars", () => {
    expect(escapeUrlFilter("a|b*c^d")).toBe("a\\|b\\*c\\^d");
  });
});

describe("normalizeDomain", () => {
  it("lowercases and strips scheme/port/path to a bare host", () => {
    expect(normalizeDomain("GitHub.com")).toBe("github.com");
    expect(normalizeDomain("https://API.Example.com:443/v1")).toBe("api.example.com");
    expect(normalizeDomain("  example.com  ")).toBe("example.com");
    expect(normalizeDomain("")).toBe("");
  });
});

describe("matcherToDnrCondition", () => {
  it("contains → bare urlFilter", () => {
    expect(matcherToDnrCondition({ mode: "contains", value: "api.x.com" }))
      .toEqual({ urlFilter: "api.x.com" });
  });
  it("starts → leading anchor", () => {
    expect(matcherToDnrCondition({ mode: "starts", value: "https://x" }))
      .toEqual({ urlFilter: "|https://x" });
  });
  it("ends → trailing anchor", () => {
    expect(matcherToDnrCondition({ mode: "ends", value: "/graphql" }))
      .toEqual({ urlFilter: "/graphql|" });
  });
  it("exact → both anchors", () => {
    expect(matcherToDnrCondition({ mode: "exact", value: "https://x/y" }))
      .toEqual({ urlFilter: "|https://x/y|" });
  });
  it("domain → requestDomains", () => {
    expect(matcherToDnrCondition({ mode: "domain", value: "example.com" }))
      .toEqual({ requestDomains: ["example.com"] });
  });
  it("domain normalizes uppercase/scheme/port/path so DNR can't reject the batch", () => {
    // DNR requires lowercase host-only entries; these ordinary inputs would
    // otherwise reject the whole updateDynamicRules call (issue #4).
    expect(matcherToDnrCondition({ mode: "domain", value: "GitHub.com" }))
      .toEqual({ requestDomains: ["github.com"] });
    expect(matcherToDnrCondition({ mode: "domain", value: "https://x.com:8080/path" }))
      .toEqual({ requestDomains: ["x.com"] });
  });
  it("throws on an unknown mode rather than emitting a filter-less (match-all) condition", () => {
    expect(() => matcherToDnrCondition({ mode: "bogus" as never, value: "x" })).toThrow(/unknown/i);
  });
  it("regex → regexFilter", () => {
    expect(matcherToDnrCondition({ mode: "regex", value: "^https://.*\\.dev/" }))
      .toEqual({ regexFilter: "^https://.*\\.dev/" });
  });
});

describe("evaluateMatcher", () => {
  const u = "https://api.example.com/v1/users?q=1";
  it("contains", () => {
    expect(evaluateMatcher({ mode: "contains", value: "example.com" }, u)).toBe(true);
    expect(evaluateMatcher({ mode: "contains", value: "nope" }, u)).toBe(false);
  });
  it("starts / ends / exact", () => {
    expect(evaluateMatcher({ mode: "starts", value: "https://api" }, u)).toBe(true);
    expect(evaluateMatcher({ mode: "ends", value: "q=1" }, u)).toBe(true);
    expect(evaluateMatcher({ mode: "exact", value: u }, u)).toBe(true);
    expect(evaluateMatcher({ mode: "exact", value: "https://api.example.com" }, u)).toBe(false);
  });
  it("domain matches host and subdomains", () => {
    expect(evaluateMatcher({ mode: "domain", value: "example.com" }, u)).toBe(true);
    expect(evaluateMatcher({ mode: "domain", value: "other.com" }, u)).toBe(false);
  });
  it("domain matching mirrors DNR normalization (uppercase/pasted-URL agree with the rule)", () => {
    expect(evaluateMatcher({ mode: "domain", value: "Example.COM" }, u)).toBe(true);
    expect(evaluateMatcher({ mode: "domain", value: "https://example.com/x" }, u)).toBe(true);
  });
  it("regex", () => {
    expect(evaluateMatcher({ mode: "regex", value: "^https://api\\." }, u)).toBe(true);
  });
  it("invalid regex is a non-match, never throws", () => {
    expect(evaluateMatcher({ mode: "regex", value: "(" }, u)).toBe(false);
  });
  it("empty value never matches (mirrors compileRules skipping an invalid DNR condition)", () => {
    expect(evaluateMatcher({ mode: "contains", value: "" }, u)).toBe(false);
    expect(evaluateMatcher({ mode: "starts", value: "" }, u)).toBe(false);
    expect(evaluateMatcher({ mode: "ends", value: "" }, u)).toBe(false);
    expect(evaluateMatcher({ mode: "regex", value: "" }, u)).toBe(false);
    expect(evaluateMatcher({ mode: "contains", value: "   " }, u)).toBe(false);
  });
});
