# 0003. Compressed config at rest

Date: 2026-07-12
Status: accepted

## Context

The entire config (all profiles and their rules, plus the master switch) is stored as a single `chrome.storage.sync` item. `chrome.storage.sync` enforces `QUOTA_BYTES_PER_ITEM` = **8 KB per item**, measured on the serialized value, and a write past it is rejected. Users with a handful of profiles can hit that ceiling and start seeing save failures (surfaced by issue #5) sooner than expected.

The config JSON is highly repetitive — every rule repeats the keys `id`/`enabled`/`op`/`name`/`value`/`matcher`/`mode` — which is exactly the shape LZString compresses well (typically ~2–3× on this data). `lz-string` is already a bundled dependency: share strings use it (ADR 0002).

Alternatives considered and rejected:

- **Split the config across multiple sync items** (one per profile). Multiplies the per-item budget but adds partial-write/consistency complexity and a migration; rejected.
- **Move to `chrome.storage.local`** (larger quota). Drops cross-device sync, which is a core feature; rejected.

## Decision

Compress the config at rest with LZString before writing to `chrome.storage.sync`, decompress on read. Keep `chrome.storage.sync` and the single-item layout.

- Encode with `LZString.compressToEncodedURIComponent` — ASCII output, so it is JSON- and quota-safe (raw / UTF16 variants risk inflation or non-round-trip when the value passes through JSON). This mirrors the share-string codec (ADR 0002).
- Prefix the stored value with a fixed marker `HHC` + a one-character **format version** (`HHC1…`), so the format can evolve and a reader can tell a compressed value apart from a legacy one.
- **Read compatibility:** a legacy raw-object config written by v1.1.0 (before compression) still reads — it is recognized as an object rather than a marker string — and is re-compressed on the next save. `null` (fresh install) and any value that fails to decode fall back to an empty config, with a `console.warn` so the fallback is never silent.
- The Options near-quota warning measures the **compressed** byte length (the real quota budget), not the raw JSON length.

The pure (de)serialization lives in `src/lib/config-codec.ts`, a WXT-free module so it is unit-testable without a fake browser; `src/lib/storage.ts` wraps it behind the existing `configStore` `get/set/watch` surface.

## Consequences

- Raises the effective config ceiling ~2–3× for typical configs while preserving cross-device sync and adding no new dependency.
- The stored value becomes opaque in DevTools (a single compressed blob) — a minor debuggability cost for one item.
- Compression does not rescue a single already-dense value (e.g. a large base64 header value); those remain bounded by the item quota.
- **Forward-compat caveat:** if a future version writes a newer format (`HHC2…`), this version reads it as "unrecognized" and falls back to an empty config; editing then saving on the old version would overwrite the newer config on sync. The version marker makes such a change explicit, but cross-version downgrade is a known sharp edge to handle when a second format is introduced.
