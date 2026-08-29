import { describe, it, expect } from "vitest";
import { matcherToDnrCondition, evaluateMatcher, escapeUrlFilter, normalizeDomain, ALL_URLS_MATCHER, isAllUrls, ruleSendsHeadersEverywhere, sendsHeadersEverywhere } from "./matcher";
import type { HeaderRule, Matcher, Profile } from "../types";

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

describe("all-URLs matcher", () => {
  it("recognizes exactly the regex .* shape", () => {
    expect(isAllUrls(ALL_URLS_MATCHER)).toBe(true);
    expect(isAllUrls({ mode: "regex", value: ".*" })).toBe(true);
    expect(isAllUrls({ mode: "regex", value: ".+" })).toBe(false);
    expect(isAllUrls({ mode: "regex", value: " .* " })).toBe(false);
    expect(isAllUrls({ mode: "contains", value: ".*" })).toBe(false);
    expect(isAllUrls({ mode: "contains", value: "" })).toBe(false);
  });

  it("is the shape the ModHeader converter already emits for no-filter profiles", () => {
    expect(ALL_URLS_MATCHER).toEqual({ mode: "regex", value: ".*" });
  });

  it("compiles to a plain match-all urlFilter, not an RE2 evaluation", () => {
    expect(matcherToDnrCondition(ALL_URLS_MATCHER)).toEqual({ urlFilter: "*" });
  });

  it("still compiles an ordinary regex through regexFilter", () => {
    expect(matcherToDnrCondition({ mode: "regex", value: "^https://x\\.dev/" }))
      .toEqual({ regexFilter: "^https://x\\.dev/" });
  });
});

function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: "p1",
    name: "P",
    enabled: true,
    matcher: { ...ALL_URLS_MATCHER },
    rules: [{ id: "r1", enabled: true, op: "set", name: "X-A", value: "1" }],
    ...over,
  };
}

describe("sendsHeadersEverywhere", () => {
  it("is true for an enabled Set rule inheriting an all-URLs profile matcher", () => {
    expect(sendsHeadersEverywhere(profile())).toBe(true);
  });

  it("is true for an Append rule too", () => {
    expect(sendsHeadersEverywhere(profile({
      rules: [{ id: "r1", enabled: true, op: "append", name: "Accept", value: "x" }],
    }))).toBe(true);
  });

  it("is false when the profile is disabled — nothing is being sent", () => {
    expect(sendsHeadersEverywhere(profile({ enabled: false }))).toBe(false);
  });

  it("is false with no rules at all", () => {
    expect(sendsHeadersEverywhere(profile({ rules: [] }))).toBe(false);
  });

  it("mirrors compileRules: a disabled or blank-name rule emits nothing", () => {
    expect(sendsHeadersEverywhere(profile({
      rules: [{ id: "r1", enabled: false, op: "set", name: "X-A", value: "1" }],
    }))).toBe(false);
    expect(sendsHeadersEverywhere(profile({
      rules: [{ id: "r1", enabled: true, op: "set", name: "   ", value: "1" }],
    }))).toBe(false);
  });

  it("is false for Remove-only rules — a Remove sends no data anywhere", () => {
    expect(sendsHeadersEverywhere(profile({
      rules: [{ id: "r1", enabled: true, op: "remove", name: "X-A" }],
    }))).toBe(false);
  });

  it("is false when every rule overrides to a narrow matcher", () => {
    expect(sendsHeadersEverywhere(profile({
      rules: [{
        id: "r1", enabled: true, op: "set", name: "X-A", value: "1",
        matcher: { mode: "domain", value: "example.com" },
      }],
    }))).toBe(false);
  });

  it("is true when a rule's own override is itself all-URLs", () => {
    expect(sendsHeadersEverywhere(profile({
      matcher: { mode: "domain", value: "example.com" },
      rules: [{
        id: "r1", enabled: true, op: "set", name: "X-A", value: "1",
        matcher: { ...ALL_URLS_MATCHER },
      }],
    }))).toBe(true);
  });
});

describe("ruleSendsHeadersEverywhere", () => {
  const set = (over: Partial<HeaderRule> = {}): HeaderRule =>
    ({ id: "r1", enabled: true, op: "set", name: "X-A", value: "1", ...over });

  it("is true for an enabled Set rule inheriting an all-URLs profile matcher", () => {
    expect(ruleSendsHeadersEverywhere(set(), { ...ALL_URLS_MATCHER })).toBe(true);
  });

  it("is true when the rule's own override is all-URLs, whatever the profile matcher is", () => {
    expect(ruleSendsHeadersEverywhere(
      set({ matcher: { ...ALL_URLS_MATCHER } }),
      { mode: "domain", value: "example.com" },
    )).toBe(true);
  });

  it("is false when the rule's own override narrows an all-URLs profile", () => {
    expect(ruleSendsHeadersEverywhere(
      set({ matcher: { mode: "domain", value: "example.com" } }),
      { ...ALL_URLS_MATCHER },
    )).toBe(false);
  });

  it("mirrors compileRules: disabled, blank-name and Remove rules send nothing", () => {
    const all = { ...ALL_URLS_MATCHER };
    expect(ruleSendsHeadersEverywhere(set({ enabled: false }), all)).toBe(false);
    expect(ruleSendsHeadersEverywhere(set({ name: "   " }), all)).toBe(false);
    expect(ruleSendsHeadersEverywhere(set({ op: "remove", value: undefined }), all)).toBe(false);
  });

  it("is true for an Append rule", () => {
    expect(ruleSendsHeadersEverywhere(set({ op: "append", name: "Accept" }), { ...ALL_URLS_MATCHER })).toBe(true);
  });

  it("is false with no effective matcher at all — compileRules skips those too", () => {
    expect(ruleSendsHeadersEverywhere(set(), undefined)).toBe(false);
  });
});

describe("ALL_URLS_MATCHER", () => {
  it("is frozen, so a caller that forgets to spread can't corrupt the default", () => {
    expect(Object.isFrozen(ALL_URLS_MATCHER)).toBe(true);
    expect(() => {
      (ALL_URLS_MATCHER as Matcher).value = "boom";
    }).toThrow();
    expect(ALL_URLS_MATCHER.value).toBe(".*");
  });
});
