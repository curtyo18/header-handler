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
