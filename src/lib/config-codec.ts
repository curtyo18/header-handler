import LZString from "lz-string";
import type { Config } from "../types";
import { emptyConfig } from "../types";
import { byteLength } from "./json-value";

// chrome.storage.sync enforces QUOTA_BYTES_PER_ITEM (8 KB) per item — far below
// the ~100 KB total quota — and the whole config is one item. A write past it
// rejects; the UI must reflect that rather than claim "Saved" (issue #5).
export const SYNC_ITEM_QUOTA_BYTES = 8192;

// Total sync quota across all items (QUOTA_BYTES), and the chunking budget. A
// config too large for one 8 KB item (QUOTA_BYTES_PER_ITEM) is split across items
// keyed off a manifest at sync:config (ADR-0005). The soft cap sits well below the
// total quota to leave headroom for the manifest, write bursts, and future items.
export const SYNC_TOTAL_QUOTA_BYTES = 102400;
export const CHUNK_PAYLOAD_BYTES = 7168; // max chars per chunk slice
export const MAX_CONFIG_CHUNKS = 12;
export const CONFIG_SOFT_CAP_BYTES = MAX_CONFIG_CHUNKS * CHUNK_PAYLOAD_BYTES; // ~84 KB

const MANIFEST_MARKER = "HHM1";

export interface Manifest {
  n: number; // chunk count
  len: number; // reassembled blob length (chars == bytes; the blob is ASCII)
  sum: number; // checksum of the reassembled blob (torn-read detection)
}

// The config JSON is highly repetitive (repeated keys id/enabled/op/name/value/
// matcher/mode per rule), so we compress it at rest with LZString to raise the
// effective 8 KB ceiling ~2–3× while keeping cross-device sync (issue #12). The
// stored value is a marker-prefixed ASCII string; compressToEncodedURIComponent
// is JSON- and quota-safe (raw/UTF16 variants risk inflation or non-round-trip
// through JSON). Mirrors the share-string format in share.ts.
const CONFIG_PREFIX = "HHC";
const CONFIG_FORMAT_VERSION = "1";
const CONFIG_MARKER = CONFIG_PREFIX + CONFIG_FORMAT_VERSION;

export function serializeConfig(cfg: Config): string {
  return CONFIG_MARKER + LZString.compressToEncodedURIComponent(JSON.stringify(cfg));
}

// Accepts either a compressed marker string or a legacy raw Config object — values
// written by v1.1.0 before compression, or the fallback null — so an already-synced
// config still reads (it re-compresses on the next save). A corrupt/undecodable
// value falls back to an empty config rather than throwing: one bad sync item must
// not wedge every consumer (background recompile, options, popup, sidepanel).
export function deserializeConfig(raw: unknown): Config {
  if (typeof raw === "string") {
    if (raw.startsWith(CONFIG_MARKER)) {
      const json = LZString.decompressFromEncodedURIComponent(raw.slice(CONFIG_MARKER.length));
      if (json) {
        try {
          return JSON.parse(json) as Config;
        } catch (e) {
          console.warn("Header Handler: stored config failed to parse; using empty config", e);
        }
      } else {
        console.warn("Header Handler: stored config failed to decompress; using empty config");
      }
    } else {
      // A string we don't recognize — e.g. a config in a newer format written by a
      // future version syncing back to this one. Logged so the fallback is visible
      // rather than a silent empty. (See the forward-compat note in issue #12.)
      console.warn("Header Handler: stored config has an unrecognized format; using empty config");
    }
    return emptyConfig();
  }
  if (raw && typeof raw === "object") return raw as Config; // legacy raw object
  return emptyConfig();
}

// Bytes the config's compressed payload occupies — what the Options near-quota UI
// budgets against CONFIG_SOFT_CAP_BYTES. Measured on the compressed blob (the
// thing that gets stored / sliced), not the raw JSON. Chunk key + JSON-quote
// overhead is small relative to the soft cap's headroom and is not counted.
export function configStorageBytes(cfg: Config): number {
  return byteLength(serializeConfig(cfg));
}

// Fast non-cryptographic string hash (cyrb53). For torn-read / corruption
// detection only — not security. Deterministic and order-sensitive.
export function checksum(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// The per-item quota counts the real chrome key length + JSON.stringify(value).
// sync:config's chrome key is "config"; the blob is ASCII so JSON adds exactly two
// quote bytes and no escapes.
const CONFIG_KEY_BYTES = 6; // length of the chrome key "config"
const JSON_QUOTE_BYTES = 2; // the surrounding quotes JSON.stringify adds to a string
function fitsOneItem(blob: string): boolean {
  return CONFIG_KEY_BYTES + byteLength(blob) + JSON_QUOTE_BYTES <= SYNC_ITEM_QUOTA_BYTES;
}

// Decide the on-disk layout for a serialized HHC1… blob. Throws a quota-flavoured
// error (surfaced by the Options /quota/i handler) when the blob needs more than
// MAX_CONFIG_CHUNKS chunks, so an over-cap save is rejected before any write.
export function planStorage(blob: string):
  | { kind: "single"; value: string }
  | { kind: "chunked"; chunks: string[]; manifest: string } {
  if (fitsOneItem(blob)) return { kind: "single", value: blob };
  const chunks: string[] = [];
  for (let i = 0; i < blob.length; i += CHUNK_PAYLOAD_BYTES) {
    chunks.push(blob.slice(i, i + CHUNK_PAYLOAD_BYTES));
  }
  if (chunks.length > MAX_CONFIG_CHUNKS) {
    throw new Error(
      `Config exceeds the sync-storage quota: needs ${chunks.length} chunks, max ${MAX_CONFIG_CHUNKS}.`,
    );
  }
  const manifest: Manifest = { n: chunks.length, len: blob.length, sum: checksum(blob) };
  return { kind: "chunked", chunks, manifest: MANIFEST_MARKER + JSON.stringify(manifest) };
}

// Parse a manifest value, or null if it isn't one (single-item HHC1…, legacy
// object, junk, null). A well-formed manifest has a chunk count within the same
// [0, MAX_CONFIG_CHUNKS] bound the writer enforces and non-negative len/sum — so a
// corrupt or hostile manifest (e.g. a huge n from a buggy peer) can't drive the
// reader into an enormous chunk-key allocation before validation rejects it.
export function parseManifest(value: unknown): Manifest | null {
  if (typeof value !== "string" || !value.startsWith(MANIFEST_MARKER)) return null;
  try {
    const m = JSON.parse(value.slice(MANIFEST_MARKER.length)) as Partial<Manifest>;
    if (
      typeof m?.n === "number" &&
      Number.isInteger(m.n) &&
      m.n >= 0 &&
      m.n <= MAX_CONFIG_CHUNKS &&
      typeof m.len === "number" &&
      m.len >= 0 &&
      typeof m.sum === "number"
    ) {
      return { n: m.n, len: m.len, sum: m.sum };
    }
  } catch {
    /* fall through to null */
  }
  return null;
}

// Validate the chunk set against its manifest, then decode. Any missing chunk,
// length mismatch, or checksum mismatch → emptyConfig() + warn, never a throw: a
// torn/partial read must not be parsed as a real config (mirrors deserializeConfig).
export function reassembleConfig(manifest: Manifest, chunkValues: (string | null | undefined)[]): Config {
  if (chunkValues.length !== manifest.n || chunkValues.some((c) => typeof c !== "string")) {
    console.warn("Header Handler: chunked config is missing chunks; using empty config");
    return emptyConfig();
  }
  const blob = (chunkValues as string[]).join("");
  if (blob.length !== manifest.len || checksum(blob) !== manifest.sum) {
    console.warn("Header Handler: chunked config failed validation (torn read); using empty config");
    return emptyConfig();
  }
  return deserializeConfig(blob);
}
