import LZString from "lz-string";
import type { Config } from "../types";
import { emptyConfig } from "../types";
import { byteLength } from "./json-value";

// chrome.storage.sync enforces QUOTA_BYTES_PER_ITEM (8 KB) per item — far below
// the ~100 KB total quota — and the whole config is one item. A write past it
// rejects; the UI must reflect that rather than claim "Saved" (issue #5).
export const SYNC_ITEM_QUOTA_BYTES = 8192;

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

// Bytes the config occupies against the per-item quota, measured on the compressed
// stored value (what Chrome actually counts) — this is what the Options warning
// budgets against, not the raw JSON length.
export function configStorageBytes(cfg: Config): number {
  return byteLength(JSON.stringify(serializeConfig(cfg)));
}
