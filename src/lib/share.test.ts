import { describe, it, expect } from "vitest";
import { encodeShare, decodeShare } from "./share";
import type { Profile, Config } from "../types";

const profile: Profile = {
  id: "abc", name: "Auth", enabled: true,
  matcher: { mode: "domain", value: "example.com" },
  rules: [{ id: "r1", enabled: true, op: "set", name: "Authorization", value: "Bearer x" }],
};

describe("share round-trip", () => {
  it("single profile strips ids and round-trips content", () => {
    const s = encodeShare({ kind: "p", profile });
    expect(s.startsWith("HH1p")).toBe(true);
    const out = decodeShare(s);
    expect(out.kind).toBe("p");
    if (out.kind !== "p") throw new Error("kind");
    expect(out.profile.name).toBe("Auth");
    expect(out.profile.id).toBe("");
    expect(out.profile.rules[0].id).toBe("");
    expect(out.profile.rules[0].value).toBe("Bearer x");
  });
  it("global bundle round-trips all profiles", () => {
    const cfg: Config = { version: 1, masterEnabled: true, profiles: [profile] };
    const s = encodeShare({ kind: "g", config: cfg });
    expect(s.startsWith("HH1g")).toBe(true);
    const out = decodeShare(s);
    if (out.kind !== "g") throw new Error("kind");
    expect(out.profiles).toHaveLength(1);
    expect(out.profiles[0].name).toBe("Auth");
  });
  it("rejects bad prefix", () => {
    expect(() => decodeShare("XX1pblah")).toThrow(/format/i);
  });
  it("rejects unknown version", () => {
    expect(() => decodeShare("HH9pblah")).toThrow(/version/i);
  });
  it("rejects corrupt payload", () => {
    expect(() => decodeShare("HH1p@@@not-lz@@@")).toThrow();
  });
});

// Hand-crafted shares (valid JSON, wrong shape) must be rejected before they can
// reach compileRules — where an unknown mode = match-all injection and a missing
// `rules`/`matcher` permanently wedges recompiles (issue #6).
import LZString from "lz-string";
const forge = (kind: "p" | "g", payload: unknown) =>
  "HH1" + kind + LZString.compressToEncodedURIComponent(JSON.stringify(payload));

describe("decodeShare schema validation", () => {
  const goodRule = { id: "", enabled: true, op: "set", name: "X", value: "1" };
  const goodMatcher = { mode: "domain", value: "example.com" };

  it("rejects a valid-JSON payload of the wrong shape", () => {
    expect(() => decodeShare(forge("p", { hello: "world" }))).toThrow(/matcher|name|rules/i);
    expect(() => decodeShare(forge("p", [1, 2, 3]))).toThrow();
  });
  it("rejects an unknown matcher mode (would compile to a match-all condition)", () => {
    expect(() =>
      decodeShare(forge("p", { name: "X", matcher: { mode: "evil", value: "" }, rules: [] })),
    ).toThrow(/matcher/i);
  });
  it("rejects a profile missing its rules array", () => {
    expect(() =>
      decodeShare(forge("p", { name: "X", matcher: goodMatcher })),
    ).toThrow(/rules/i);
  });
  it("rejects a rule with an invalid operation", () => {
    expect(() =>
      decodeShare(forge("p", { name: "X", matcher: goodMatcher, rules: [{ ...goodRule, op: "hack" }] })),
    ).toThrow(/operation/i);
  });
  it("rejects a bundle whose profiles list is missing", () => {
    expect(() => decodeShare(forge("g", { notProfiles: [] }))).toThrow(/profiles/i);
  });
  it("accepts a well-formed profile", () => {
    const out = decodeShare(forge("p", { name: "X", enabled: true, matcher: goodMatcher, rules: [goodRule] }));
    expect(out.kind).toBe("p");
  });
});
