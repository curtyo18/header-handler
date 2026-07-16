import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Config } from "../types";
import { emptyConfig } from "../types";

// In-memory wxt/storage mock. Keys are full "sync:…" strings. defineItem returns
// a thin get/set/watch bound to one key; getItems/setItems/removeItems are batch.
const mem = new Map<string, unknown>();
const watchers = new Map<string, Set<(v: unknown) => void>>();

function emit(key: string) {
  watchers.get(key)?.forEach((cb) => cb(mem.get(key) ?? null));
}

vi.mock("wxt/storage", () => ({
  storage: {
    defineItem: (key: string, opts: { fallback: unknown }) => ({
      getValue: async () => (mem.has(key) ? mem.get(key) : opts.fallback),
      setValue: async (v: unknown) => {
        mem.set(key, v);
        emit(key);
      },
      watch: (cb: (v: unknown) => void) => {
        const set = watchers.get(key) ?? new Set();
        set.add(cb);
        watchers.set(key, set);
        return () => set.delete(cb);
      },
    }),
    getItems: async (keys: string[]) => keys.map((key) => ({ key, value: mem.has(key) ? mem.get(key) : null })),
    setItems: async (items: { key: string; value: unknown }[]) => {
      for (const { key, value } of items) {
        mem.set(key, value);
        emit(key);
      }
    },
    removeItems: async (keys: string[]) => {
      for (const key of keys) {
        mem.delete(key);
        emit(key);
      }
    },
  },
}));

// Import AFTER the mock is registered.
import { configStore } from "./storage";
import { serializeConfig, parseManifest, MAX_CONFIG_CHUNKS } from "./config-codec";

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

// setValue coalesces on a 500ms trailing timer; drive it with fake timers.
async function saveNow(cfg: Config) {
  const p = configStore.setValue(cfg);
  await vi.advanceTimersByTimeAsync(500);
  await p;
}

describe("configStore chunking", () => {
  beforeEach(() => {
    mem.clear();
    watchers.clear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("stores a small config as a single HHC1 item and reads it back", async () => {
    const cfg: Config = { version: 1, masterEnabled: true, profiles: [] };
    await saveNow(cfg);
    expect((mem.get("sync:config") as string).startsWith("HHC1")).toBe(true);
    expect(mem.has("sync:config/0")).toBe(false);
    expect(await configStore.getValue()).toEqual(cfg);
  });

  it("stores a large config as a manifest + chunk items and reads it back", async () => {
    const cfg = bigConfig(60);
    await saveNow(cfg);
    const manifest = parseManifest(mem.get("sync:config"));
    expect(manifest).not.toBeNull();
    expect(manifest!.n).toBeGreaterThan(1);
    expect(mem.has(`sync:config/${manifest!.n - 1}`)).toBe(true);
    expect(await configStore.getValue()).toEqual(cfg);
  });

  it("garbage-collects orphan chunks when the config shrinks back to one item", async () => {
    await saveNow(bigConfig(60));
    const prevN = parseManifest(mem.get("sync:config"))!.n;
    await saveNow({ version: 1, masterEnabled: true, profiles: [] });
    expect((mem.get("sync:config") as string).startsWith("HHC1")).toBe(true);
    for (let i = 0; i < prevN; i++) expect(mem.has(`sync:config/${i}`)).toBe(false);
  });

  it("reads a torn manifest (missing chunk) as an empty config", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await saveNow(bigConfig(60));
    const n = parseManifest(mem.get("sync:config"))!.n;
    mem.delete(`sync:config/${n - 1}`);
    expect(await configStore.getValue()).toEqual(emptyConfig());
    warn.mockRestore();
  });

  it("adopts an old-peer single-item overwrite and GCs orphans on next write", async () => {
    await saveNow(bigConfig(60));
    const peerCfg: Config = {
      version: 1,
      masterEnabled: true,
      profiles: [{ id: "x", name: "Peer", enabled: true, matcher: { mode: "contains", value: "a" }, rules: [] }],
    };
    mem.set("sync:config", serializeConfig(peerCfg));
    expect(await configStore.getValue()).toEqual(peerCfg);
    await saveNow(peerCfg);
    expect(mem.has("sync:config/0")).toBe(false);
  });

  it("coalesces a burst of saves into one write carrying the last value", async () => {
    const a: Config = { version: 1, masterEnabled: true, profiles: [] };
    const b: Config = { version: 1, masterEnabled: false, profiles: [] };
    const p1 = configStore.setValue(a);
    const p2 = configStore.setValue(b);
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all([p1, p2]);
    expect(await configStore.getValue()).toEqual(b);
  });
});

void MAX_CONFIG_CHUNKS;
