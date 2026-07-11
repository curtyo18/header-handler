import { describe, it, expect } from "vitest";
import { byteLength, validateJson, isLikelyJson, formatJson, minifyJson } from "./json-value";

describe("byteLength", () => {
  it("counts UTF-8 bytes, not chars", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("€")).toBe(3);
  });
});

describe("validateJson", () => {
  it("accepts valid JSON", () => {
    expect(validateJson('{"a":1}')).toEqual({ valid: true });
  });
  it("rejects invalid JSON with a message", () => {
    const r = validateJson("{a:1}");
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });
  it("treats empty as invalid without a message", () => {
    expect(validateJson("   ")).toEqual({ valid: false });
  });
});

describe("isLikelyJson", () => {
  it("true for parseable object/array", () => {
    expect(isLikelyJson('  {"a":1} ')).toBe(true);
    expect(isLikelyJson("[1,2]")).toBe(true);
  });
  it("false for plain strings or bare tokens", () => {
    expect(isLikelyJson("Bearer abc")).toBe(false);
    expect(isLikelyJson("123")).toBe(false); // not structural
    expect(isLikelyJson("{nope}")).toBe(false); // structural but unparseable
  });
});

describe("formatJson / minifyJson", () => {
  it("format pretty-prints with 2 spaces", () => {
    expect(formatJson('{"a":1,"b":2}')).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });
  it("minify collapses to one line", () => {
    expect(minifyJson('{\n  "a": 1\n}')).toBe('{"a":1}');
  });
  it("round-trips format→minify", () => {
    const src = '{"x":[1,2,3],"y":{"z":true}}';
    expect(minifyJson(formatJson(src))).toBe(src);
  });
  it("leaves invalid input untouched", () => {
    expect(formatJson("{a:1}")).toBe("{a:1}");
    expect(minifyJson("nope")).toBe("nope");
  });
});
