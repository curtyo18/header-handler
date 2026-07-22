import { describe, it, expect } from "vitest";
import { decompressRawSnappy, extractSnappyJsonTexts } from "./snappy";

// Every byte here is SYNTHETIC — hand-built Snappy streams, never a real export.

// Latin-1 bytes of an ASCII string (each char -> its low byte).
function toBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

// Little-endian base-128 varint encoder (mirror of the decoder's preamble).
function varint(n: number): number[] {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

// Build a literal-only raw Snappy stream: length varint + one literal element
// carrying the whole payload verbatim. Exercises 1/2/3-byte varints by payload size.
function buildLiteralStream(payload: Uint8Array): Uint8Array {
  const head: number[] = varint(payload.length);
  const litLen = payload.length;
  if (litLen <= 60) {
    head.push((litLen - 1) << 2); // type 0, len-1 inline
  } else {
    const x = litLen - 1;
    const k = x <= 0xff ? 1 : x <= 0xffff ? 2 : x <= 0xffffff ? 3 : 4;
    head.push((59 + k) << 2); // type 0, (59+k) selects k trailing length bytes
    for (let i = 0; i < k; i++) head.push((x >>> (8 * i)) & 0xff);
  }
  const out = new Uint8Array(head.length + payload.length);
  out.set(head, 0);
  out.set(payload, head.length);
  return out;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

// Deterministic pseudo-noise: no "headers", and no coincidental valid blob.
function noise(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 37 + 11) & 0xff;
  return b;
}

// Filler that provably never passes the prefilter: every byte < 0x80 is a
// single-byte varint decoding to < 128, below the MIN_DECODED (256) floor, so
// each offset fails the length check without a decode attempt. Used to place a
// valid block far past any byte-counting attempt cap.
function lowFiller(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 37 + 11) & 0x7f;
  return b;
}

// Build a raw Snappy stream whose DECODED length is far larger than its COMPRESSED
// span: a small literal `prefix` then overlapping copies that repeat it forward to
// `decodedLen`. The decoded text contains `prefix` (and thus its marker). Used to
// prove the locator advances by consumed INPUT bytes, not the decoded length.
function buildInflatedStream(prefix: Uint8Array, decodedLen: number): Uint8Array {
  const P = prefix.length; // kept <= 60 so the literal tag is a single byte
  const bytes: number[] = [...varint(decodedLen), (P - 1) << 2, ...prefix];
  let outPos = P;
  while (outPos < decodedLen) {
    const len = Math.min(64, decodedLen - outPos); // copy2 max length is 64
    const offset = P; // copy the prefix region; overlap repeats it forward
    bytes.push(((len - 1) << 2) | 2, offset & 0xff, (offset >> 8) & 0xff);
    outPos += len;
  }
  return new Uint8Array(bytes);
}

const bytesToString = (b: Uint8Array) => String.fromCharCode(...b);

// A realistic ModHeader-ish profiles value, padded past MIN_DECODED (256 bytes)
// so extractSnappyJsonTexts accepts it. Contains the "headers" marker.
const modheaderJson = (value: string) =>
  JSON.stringify([
    { title: "Test", urlFilters: [], headers: [{ name: "x-mock-response", value, enabled: true }] },
  ]) + " ".repeat(256);

describe("decompressRawSnappy", () => {
  it("round-trips a literal-only stream of ModHeader-ish JSON", () => {
    const json = modheaderJson("round-trip-value");
    expect(json).toContain('"headers"');
    const decoded = decompressRawSnappy(buildLiteralStream(toBytes(json)));
    expect(bytesToString(decoded)).toBe(json);
  });

  it("decodes an overlapping copy (offset < len) into a repeated pattern", () => {
    // Hand-computed vector decoding to "abababab":
    //   0x08 -> uncompressed length 8
    //   0x04 -> literal, len (0>>2)+1 = ... 0x04>>2 = 1 -> litLen 2; bytes 'a','b'
    //   0x09,0x02 -> copy type 1: len ((0x09>>2)&7)+4 = 2+4 = 6, offset 2
    // Copy walks byte-by-byte from out[outPos-2], repeating "ab" forward.
    const stream = new Uint8Array([0x08, 0x04, 0x61, 0x62, 0x09, 0x02]);
    const decoded = decompressRawSnappy(stream);
    expect(bytesToString(decoded)).toBe("abababab");
  });

  it("handles a 2-byte varint length (payload > 127 bytes)", () => {
    const json = modheaderJson("x".repeat(200)); // well over 127 decoded bytes
    const stream = buildLiteralStream(toBytes(json));
    expect(varint(toBytes(json).length).length).toBe(2);
    expect(bytesToString(decompressRawSnappy(stream))).toBe(json);
  });

  it("handles a 3-byte varint length (payload > 16383 bytes)", () => {
    const json = modheaderJson("y".repeat(20000)); // over 16383 decoded bytes
    const bytes = toBytes(json);
    expect(varint(bytes.length).length).toBe(3);
    expect(bytesToString(decompressRawSnappy(buildLiteralStream(bytes)))).toBe(json);
  });

  it("throws on a copy offset pointing before output start", () => {
    // literal "ab" (outPos 2), then copy type 1 with offset 100 > outPos.
    const stream = new Uint8Array([0x08, 0x04, 0x61, 0x62, 0x01, 0x64]);
    expect(() => decompressRawSnappy(stream)).toThrow();
  });

  it("throws on truncated input (declared length not reached)", () => {
    // Declares length 8 but supplies only a 2-byte literal, then ends.
    const stream = new Uint8Array([0x08, 0x04, 0x61, 0x62]);
    expect(() => decompressRawSnappy(stream)).toThrow();
  });
});

describe("extractSnappyJsonTexts", () => {
  it("finds a single compressed ModHeader blob embedded in noise", () => {
    const json = modheaderJson("MARKER-VALUE-123");
    const dump = concat(noise(400), buildLiteralStream(toBytes(json)), noise(400));
    const found = extractSnappyJsonTexts(dump);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('"headers"');
    expect(found[0]).toContain("MARKER-VALUE-123");
  });

  it("decodes a recovered block as UTF-8, preserving non-ASCII header values", () => {
    // A profile value with multi-byte UTF-8 (accented + arrow). Decoding the block
    // as Latin-1 would corrupt these (é -> Ã©); UTF-8 keeps them intact.
    const json = modheaderJson("café-señor-→-値");
    const stream = buildLiteralStream(new TextEncoder().encode(json));
    const found = extractSnappyJsonTexts(stream);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("café-señor-→-値");
  });

  it("returns [] for a dump with no valid blob", () => {
    expect(extractSnappyJsonTexts(noise(4096))).toEqual([]);
  });

  it("finds a valid block located far past any byte-counting attempt cap", () => {
    // Bug A: the old cap counted cheap prefilter skips, abandoning the scan after
    // ~MAX_ATTEMPTS bytes. Put a valid block well beyond that so only a whole-buffer
    // prefilter reaches it.
    const json = modheaderJson("LATE-BLOCK-VALUE");
    const dump = concat(lowFiller(300_000), buildLiteralStream(toBytes(json)));
    const found = extractSnappyJsonTexts(dump);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("LATE-BLOCK-VALUE");
  });

  it("finds an adjacent block packed right after an inflating one", () => {
    // Bug B: on success the old cursor jumped by the DECODED length, overshooting
    // the compressed span and skipping the very next packed block. blobA decodes to
    // ~5000 bytes from ~200 compressed bytes; blobB sits immediately after it.
    const a = buildInflatedStream(toBytes('"headers"BLOB-A-VALUE'), 5000);
    const b = buildLiteralStream(toBytes(modheaderJson("BLOB-B-VALUE")));
    const dump = concat(a, b); // no gap — blobB starts where blobA's input ends
    const found = extractSnappyJsonTexts(dump);
    expect(found).toHaveLength(2);
    expect(found.some((t) => t.includes("BLOB-A-VALUE"))).toBe(true);
    expect(found.some((t) => t.includes("BLOB-B-VALUE"))).toBe(true);
  });

  it("finds two distinct compressed blobs", () => {
    const a = modheaderJson("BLOB-A-VALUE");
    const b = modheaderJson("BLOB-B-VALUE");
    const dump = concat(
      noise(300),
      buildLiteralStream(toBytes(a)),
      noise(500),
      buildLiteralStream(toBytes(b)),
      noise(300),
    );
    const found = extractSnappyJsonTexts(dump);
    expect(found).toHaveLength(2);
    expect(found.some((t) => t.includes("BLOB-A-VALUE"))).toBe(true);
    expect(found.some((t) => t.includes("BLOB-B-VALUE"))).toBe(true);
  });
});
