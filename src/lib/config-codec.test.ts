import { describe, it, expect, vi } from "vitest";
import LZString from "lz-string";
import {
  serializeConfig,
  deserializeConfig,
  configStorageBytes,
  SYNC_ITEM_QUOTA_BYTES,
  CHUNK_PAYLOAD_BYTES,
  MAX_CONFIG_CHUNKS,
  CONFIG_SOFT_CAP_BYTES,
  checksum,
  planStorage,
  parseManifest,
  reassembleConfig,
} from "./config-codec";
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

// A config whose serialized blob is guaranteed to span multiple chunks: many
// profiles with a long, low-compressibility matcher value (random-ish hex).
function bigConfig(profileCount: number): Config {
  return {
    version: 1,
    masterEnabled: true,
    profiles: Array.from({ length: profileCount }, (_, i) => ({
      id: `p${i}`,
      name: `Profile ${i}`,
      enabled: true,
      matcher: { mode: "regex", value: Array.from({ length: 40 }, (_, j) => (i * 7 + j * 13).toString(16) + "abc123def").join("|") },
      rules: [{ id: `r${i}`, enabled: true, op: "set", name: "X-Auth", value: `token-${i}-${"z".repeat(30)}` }],
    })),
  };
}

describe("chunked storage (ADR-0005)", () => {
  it("checksum is deterministic and order-sensitive", () => {
    expect(checksum("abc")).toBe(checksum("abc"));
    expect(checksum("abc")).not.toBe(checksum("acb"));
    expect(checksum("")).toBe(checksum(""));
  });

  it("plans a small config as a single item", () => {
    const plan = planStorage(serializeConfig(sampleConfig(1)));
    expect(plan.kind).toBe("single");
    if (plan.kind === "single") expect(plan.value.startsWith("HHC1")).toBe(true);
  });

  it("plans a large config into <= MAX chunks with a matching manifest", () => {
    const blob = serializeConfig(bigConfig(60));
    const plan = planStorage(blob);
    expect(plan.kind).toBe("chunked");
    if (plan.kind !== "chunked") return;
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks.length).toBeLessThanOrEqual(MAX_CONFIG_CHUNKS);
    expect(plan.chunks.every((c) => c.length <= CHUNK_PAYLOAD_BYTES)).toBe(true);
    expect(plan.chunks.join("")).toBe(blob);
    const m = parseManifest(plan.manifest);
    expect(m).toEqual({ n: plan.chunks.length, len: blob.length, sum: checksum(blob) });
  });

  it("throws a quota-flavoured error above the soft cap", () => {
    expect(() => planStorage("HHC1" + "x".repeat(CONFIG_SOFT_CAP_BYTES + 10))).toThrow(/quota/i);
  });

  it("parseManifest rejects non-manifest values", () => {
    expect(parseManifest("HHC1abc")).toBeNull();
    expect(parseManifest("random")).toBeNull();
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest("HHM1{not json")).toBeNull();
  });

  it("parseManifest rejects a manifest whose chunk count is out of bounds", () => {
    // A hostile/corrupt n must not drive the reader into a huge chunk-key allocation.
    expect(parseManifest('HHM1{"n":1000000000,"len":0,"sum":0}')).toBeNull();
    expect(parseManifest(`HHM1{"n":${MAX_CONFIG_CHUNKS + 1},"len":0,"sum":0}`)).toBeNull();
    expect(parseManifest('HHM1{"n":-1,"len":0,"sum":0}')).toBeNull();
    expect(parseManifest('HHM1{"n":1.5,"len":0,"sum":0}')).toBeNull();
    expect(parseManifest('HHM1{"n":1,"len":-1,"sum":0}')).toBeNull();
  });

  it("round-trips a large config through plan -> reassemble", () => {
    const cfg = bigConfig(60);
    const plan = planStorage(serializeConfig(cfg));
    if (plan.kind !== "chunked") throw new Error("expected chunked");
    const m = parseManifest(plan.manifest)!;
    expect(reassembleConfig(m, plan.chunks)).toEqual(cfg);
  });

  it("reassemble falls back to empty on a missing chunk, wrong length, or bad checksum", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blob = serializeConfig(bigConfig(60));
    const plan = planStorage(blob);
    if (plan.kind !== "chunked") throw new Error("expected chunked");
    const m = parseManifest(plan.manifest)!;
    expect(reassembleConfig(m, [plan.chunks[0], null, ...plan.chunks.slice(2)])).toEqual(emptyConfig());
    expect(reassembleConfig(m, plan.chunks.slice(0, m.n - 1))).toEqual(emptyConfig());
    const corrupt = [...plan.chunks];
    corrupt[0] = "Z" + corrupt[0].slice(1);
    expect(reassembleConfig(m, corrupt)).toEqual(emptyConfig());
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
