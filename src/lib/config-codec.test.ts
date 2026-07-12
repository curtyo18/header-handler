import { describe, it, expect, vi } from "vitest";
import LZString from "lz-string";
import { serializeConfig, deserializeConfig, configStorageBytes, SYNC_ITEM_QUOTA_BYTES } from "./config-codec";
import type { Config } from "../types";
import { emptyConfig } from "../types";

function sampleConfig(profileCount = 3): Config {
  return {
    version: 1,
    masterEnabled: true,
    profiles: Array.from({ length: profileCount }, (_, i) => ({
      id: `p${i}`,
      name: `Profile ${i}`,
      enabled: true,
      matcher: { mode: "contains", value: `example${i}.com` },
      rules: [
        { id: `r${i}a`, enabled: true, op: "set", name: "X-Auth", value: `token-${i}` },
        { id: `r${i}b`, enabled: false, op: "remove", name: "Referer" },
      ],
    })),
  };
}

describe("config compression at rest (#12)", () => {
  it("round-trips a config through serialize → deserialize", () => {
    const cfg = sampleConfig();
    expect(deserializeConfig(serializeConfig(cfg))).toEqual(cfg);
  });

  it("round-trips an empty config", () => {
    expect(deserializeConfig(serializeConfig(emptyConfig()))).toEqual(emptyConfig());
  });

  it("compresses a repetitive config well under the raw JSON size", () => {
    const cfg = sampleConfig(8);
    const raw = JSON.stringify(cfg).length;
    const compressed = configStorageBytes(cfg);
    expect(compressed).toBeLessThan(raw);
    expect(compressed).toBeLessThan(SYNC_ITEM_QUOTA_BYTES);
  });

  it("reads a legacy raw-object value written before compression", () => {
    const legacy = sampleConfig(1);
    // v1.1.0 stored the Config object directly, not a compressed string.
    expect(deserializeConfig(legacy)).toEqual(legacy);
  });

  it("falls back to an empty config for null, undecodable, non-JSON, or unrecognized values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // null: fresh install → fallback, no warning.
    expect(deserializeConfig(null)).toEqual(emptyConfig());
    // Marker present but the body won't decompress.
    expect(deserializeConfig("HHC1not-valid-lzstring!!!")).toEqual(emptyConfig());
    // Marker present, decompresses to a string that isn't JSON → exercises the parse catch.
    const nonJson = "HHC1" + LZString.compressToEncodedURIComponent("not json{");
    expect(deserializeConfig(nonJson)).toEqual(emptyConfig());
    // A string in some future/unknown format we don't recognize.
    expect(deserializeConfig("random junk without marker")).toEqual(emptyConfig());
    expect(warn).toHaveBeenCalledTimes(3); // every string fallback logs; null does not
    warn.mockRestore();
  });
});
