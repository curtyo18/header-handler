import { describe, it, expect } from "vitest";
import { isAppendableHeader, APPENDABLE_HEADERS } from "./dnr-headers";

describe("isAppendableHeader", () => {
  it("is true for headers on Chrome's append allowlist, case-insensitively", () => {
    expect(isAppendableHeader("Cookie")).toBe(true);
    expect(isAppendableHeader("user-agent")).toBe(true);
    expect(isAppendableHeader("X-Forwarded-For")).toBe(true);
    expect(isAppendableHeader("  Accept-Encoding  ")).toBe(true);
  });
  it("is false for Authorization and arbitrary custom headers", () => {
    expect(isAppendableHeader("Authorization")).toBe(false);
    expect(isAppendableHeader("X-My-Header")).toBe(false);
    expect(isAppendableHeader("Set-Cookie")).toBe(false);
  });
  it("exports the raw allowlist as a 21-entry set", () => {
    expect(APPENDABLE_HEADERS.size).toBe(21);
  });
});
