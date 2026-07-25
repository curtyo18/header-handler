import { describe, it, expect } from "vitest";
import { matchChips, matchedHighlightNames, opGlyph, resolveMatches } from "./main";
import type { Config, Profile, HeaderRule } from "../../src/types";

function profileWith(rules: HeaderRule[]): Profile {
  return {
    id: "p1", name: "A", enabled: true,
    matcher: { mode: "domain", value: "example.com" },
    rules,
  };
}

describe("opGlyph", () => {
  it("uses + for set, ~ for append, and − for remove", () => {
    expect(opGlyph("set")).toBe("+");
    expect(opGlyph("append")).toBe("~");
    expect(opGlyph("remove")).toBe("−");
  });
});

describe("matchChips", () => {
  it("labels an append rule's chip distinctly from set and remove", () => {
    const profile = profileWith([
      { id: "r1", enabled: true, op: "set", name: "X-Set", value: "1" },
      { id: "r2", enabled: true, op: "append", name: "X-App", value: "2" },
      { id: "r3", enabled: true, op: "remove", name: "X-Rm" },
    ]);
    const cfg: Config = { version: 1, masterEnabled: true, profiles: [profile] };
    const matches = resolveMatches(cfg, ["p1:r1", "p1:r2", "p1:r3"]);
    const chips = matchChips(matches);
    expect(chips.map((c) => c.label)).toEqual(["A › +X-Set", "A › ~X-App", "A › −X-Rm"]);
  });
});

describe("matchedHighlightNames", () => {
  it("includes both set and append rule names, excludes remove", () => {
    const profile = profileWith([
      { id: "r1", enabled: true, op: "set", name: "X-Set", value: "1" },
      { id: "r2", enabled: true, op: "append", name: "X-App", value: "2" },
      { id: "r3", enabled: true, op: "remove", name: "X-Rm" },
    ]);
    const cfg: Config = { version: 1, masterEnabled: true, profiles: [profile] };
    const matches = resolveMatches(cfg, ["p1:r1", "p1:r2", "p1:r3"]);
    const names = matchedHighlightNames(matches);
    expect(names.has("x-set")).toBe(true);
    expect(names.has("x-app")).toBe(true);
    expect(names.has("x-rm")).toBe(false);
  });
});
