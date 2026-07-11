import { describe, it, expect } from "vitest";
import { matcherToDnrCondition, evaluateMatcher, escapeUrlFilter } from "./matcher";

describe("escapeUrlFilter", () => {
  it("escapes DNR anchor/wildcard chars", () => {
    expect(escapeUrlFilter("a|b*c^d")).toBe("a\\|b\\*c\\^d");
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
  it("regex", () => {
    expect(evaluateMatcher({ mode: "regex", value: "^https://api\\." }, u)).toBe(true);
  });
  it("invalid regex is a non-match, never throws", () => {
    expect(evaluateMatcher({ mode: "regex", value: "(" }, u)).toBe(false);
  });
});
