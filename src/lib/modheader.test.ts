import { describe, it, expect } from "vitest";
import { convertModHeader } from "./modheader";
import { encodeShare, decodeShare } from "./share";

describe("convertModHeader", () => {
  it("throws on input without a profiles array", () => {
    expect(() => convertModHeader({})).toThrow("Not a ModHeader export: missing profiles array");
    expect(() => convertModHeader(null)).toThrow("Not a ModHeader export: missing profiles array");
  });

  it("maps a single enabled urlFilter to a regex matcher", () => {
    const { config } = convertModHeader({
      version: 2,
      profiles: [{ title: "A", urlFilters: [{ enabled: true, urlRegex: ".*foo.*" }], headers: [] }],
    });
    // DNR regexFilter is a partial match, so ModHeader's bounding ".*" is redundant
    // and stripped to keep RE2 within its per-regex memory budget.
    expect(config.profiles[0].matcher).toEqual({ mode: "regex", value: "foo" });
  });

  it("ORs multiple enabled urlFilters into one alternation regex", () => {
    const { config } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: "a" }, { enabled: true, urlRegex: "b" }],
        headers: [],
      }],
    });
    expect(config.profiles[0].matcher).toEqual({ mode: "regex", value: "(?:a)|(?:b)" });
  });

  it("strips bounding wildcards and OR-joins with non-capturing groups (RE2 memory fix)", () => {
    // The exact shape ModHeader produces for several 'contains' filters — the old
    // output (.*X.*) wrapped in capturing groups exceeded Chrome's RE2 memory limit.
    const { config } = convertModHeader({
      profiles: [{
        title: "Payments",
        urlFilters: [
          { enabled: true, urlRegex: ".*checkoutPayment\\.page.*" },
          { enabled: true, urlRegex: ".*myaccount\\/payment\\.page.*" },
          { enabled: true, urlRegex: ".*dcx-payments-.*" },
          { enabled: true, urlRegex: ".*myaccount\\/makePayment\\.page.*" },
        ],
        headers: [],
      }],
    });
    expect(config.profiles[0].matcher).toEqual({
      mode: "regex",
      value: "(?:checkoutPayment\\.page)|(?:myaccount\\/payment\\.page)|(?:dcx-payments-)|(?:myaccount\\/makePayment\\.page)",
    });
    // No leading ".*" on any alternative — that was the RE2 state blow-up.
    expect(config.profiles[0].matcher.value).not.toContain(".*");
  });

  it("preserves an internal .* and an anchored form when stripping bounds", () => {
    const { config } = convertModHeader({
      profiles: [{ title: "A", urlFilters: [{ enabled: true, urlRegex: "^.*a.*b.*$" }], headers: [] }],
    });
    expect(config.profiles[0].matcher).toEqual({ mode: "regex", value: "a.*b" });
  });

  it("keeps a wildcard-only filter as-is rather than emptying it", () => {
    const { config } = convertModHeader({
      profiles: [{ title: "A", urlFilters: [{ enabled: true, urlRegex: ".*" }], headers: [] }],
    });
    expect(config.profiles[0].matcher).toEqual({ mode: "regex", value: ".*" });
  });

  it("ignores disabled urlFilters when building the matcher", () => {
    const { config } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: false, urlRegex: "off" }, { enabled: true, urlRegex: "on" }],
        headers: [],
      }],
    });
    expect(config.profiles[0].matcher).toEqual({ mode: "regex", value: "on" });
  });

  it("falls back to .* and warns when no active filter", () => {
    const { config, warnings } = convertModHeader({ profiles: [{ title: "A", headers: [] }] });
    expect(config.profiles[0].matcher).toEqual({ mode: "regex", value: ".*" });
    expect(warnings).toContainEqual('Profile "A" has no URL filter, so it matches all URLs — review its scope before enabling.');
  });

  it("summarises no-filter profiles into a single warning", () => {
    const { warnings } = convertModHeader({
      profiles: [{ title: "A", headers: [] }, { title: "B", headers: [] }, { title: "C", headers: [] }],
    });
    const noFilter = warnings.filter((w) => w.includes("no URL filter"));
    expect(noFilter).toHaveLength(1);
    expect(noFilter[0]).toBe(
      '3 profiles have no URL filter, so they match all URLs — review their scope before enabling: "A", "B", "C".',
    );
  });

  it("names an untitled profile by position", () => {
    const { config } = convertModHeader({ profiles: [{ headers: [] }] });
    expect(config.profiles[0].name).toBe("Imported profile 1");
  });

  it("always imports profiles disabled", () => {
    const { config } = convertModHeader({
      profiles: [{ title: "A", urlFilters: [{ enabled: true, urlRegex: "x" }], headers: [] }],
    });
    expect(config.profiles[0].enabled).toBe(false);
  });

  it("maps headers to Set rules, preserving enabled and skipping empty names", () => {
    const { config } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: "x" }],
        headers: [
          { name: "X-One", value: "1", enabled: true },
          { name: "X-Two", value: "2", enabled: false },
          { name: "", value: "skip" },
        ],
      }],
    });
    expect(config.profiles[0].rules).toEqual([
      { id: "", enabled: true, op: "set", name: "X-One", value: "1" },
      { id: "", enabled: false, op: "set", name: "X-Two", value: "2" },
    ]);
  });

  it("warns when a header uses append mode (becomes Set)", () => {
    const { warnings } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: "x" }],
        headers: [{ name: "X-App", value: "v", enabled: true, appendMode: true }],
      }],
    });
    expect(warnings).toContainEqual('Profile "A" header "X-App": append became overwrite (Set).');
  });

  it("warns on dropped excludeUrlFilters, methods, and respHeaders", () => {
    const { warnings } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: "x", methods: ["GET"] }],
        excludeUrlFilters: [{ enabled: true, urlRegex: "no" }],
        respHeaders: [{ name: "X-Resp", value: "r", enabled: true }],
        headers: [],
      }],
    });
    expect(warnings).toContainEqual('Profile "A": 1 exclude filter(s) dropped (not supported) — headers may apply to URLs you excluded.');
    expect(warnings).toContainEqual('Profile "A": HTTP-method filter dropped (not supported) — rule applies to all methods.');
    expect(warnings).toContainEqual('Profile "A": 1 response-header rule(s) dropped — Header Handler only edits request headers.');
  });

  it("produces a global share string that round-trips through decodeShare", () => {
    const { config } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: ".*foo.*" }],
        headers: [{ name: "X-One", value: "1", enabled: true }],
      }],
    });
    const str = encodeShare({ kind: "g", config });
    expect(str.startsWith("HH1g")).toBe(true);
    const decoded = decodeShare(str);
    expect(decoded.kind).toBe("g");
    if (decoded.kind === "g") {
      expect(decoded.profiles).toHaveLength(1);
      expect(decoded.profiles[0].name).toBe("A");
      expect(decoded.profiles[0].enabled).toBe(false);
      expect(decoded.profiles[0].matcher).toEqual({ mode: "regex", value: "foo" });
      expect(decoded.profiles[0].rules[0].name).toBe("X-One");
    }
  });
});
