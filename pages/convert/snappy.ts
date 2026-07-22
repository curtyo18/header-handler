// Recover ModHeader profiles that survive only inside Snappy-compressed LevelDB
// blocks. Chrome compresses LevelDB data blocks with Google's Snappy "raw" block
// format (no stream identifier, no CRC — just a length varint then a sequence of
// literal/copy tags), and ModHeader's chrome.storage.sync cloud backups routinely
// land in those compressed blocks. The plaintext scanner (scan.ts) decodes the
// dump as text and never sees inside them, so those profiles are invisible. This
// module hand-rolls a Snappy raw decoder (zero runtime deps) and a bounded locator
// that finds and decompresses those regions so their JSON becomes scannable.

// Decode ONE raw Snappy stream starting at input[start], returning both the
// decoded bytes and how many INPUT bytes the stream consumed (final pos - start).
// The locator uses `consumed` to land its cursor exactly on the next packed block
// rather than overshooting by the decoded length. Throws on any malformed tag (bad
// offset, over-read, over-run) so the locator can try/catch cheaply.
function decodeRaw(input: Uint8Array, start: number): { out: Uint8Array; consumed: number } {
  let pos = start;

  // Preamble: little-endian base-128 varint holding the uncompressed length.
  let outLen = 0;
  let shift = 0;
  for (;;) {
    if (pos >= input.length) throw new Error("snappy: truncated varint");
    const b = input[pos++];
    outLen |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
    // A 32-bit length fits in 5 bytes (max shift 28); reject a 6th byte before its
    // `<< 35` would wrap under JS's & 31 shift mask and corrupt the value.
    if (shift > 28) throw new Error("snappy: varint too long");
  }
  outLen >>>= 0;

  const out = new Uint8Array(outLen);
  let outPos = 0;

  while (outPos < outLen) {
    if (pos >= input.length) throw new Error("snappy: truncated tag");
    const tag = input[pos++];
    const type = tag & 0x03;

    if (type === 0) {
      // Literal. Low 6 bits hold (len-1), or select 1..4 trailing length bytes.
      let litLen = tag >> 2;
      if (litLen < 60) {
        litLen += 1;
      } else {
        const extra = litLen - 59; // 1..4 bytes holding (litLen-1) little-endian
        if (pos + extra > input.length) throw new Error("snappy: truncated literal length");
        let v = 0;
        for (let i = 0; i < extra; i++) v |= input[pos++] << (8 * i);
        litLen = (v >>> 0) + 1;
      }
      if (pos + litLen > input.length) throw new Error("snappy: literal past input end");
      if (outPos + litLen > outLen) throw new Error("snappy: literal past output end");
      out.set(input.subarray(pos, pos + litLen), outPos);
      pos += litLen;
      outPos += litLen;
      continue;
    }

    // Copy op: read length + back-offset per the three encodings.
    let len: number;
    let offset: number;
    if (type === 1) {
      len = ((tag >> 2) & 0x07) + 4;
      if (pos >= input.length) throw new Error("snappy: truncated copy1 offset");
      offset = ((tag >> 5) << 8) | input[pos++];
    } else if (type === 2) {
      len = (tag >> 2) + 1;
      if (pos + 2 > input.length) throw new Error("snappy: truncated copy2 offset");
      offset = input[pos++] | (input[pos++] << 8);
    } else {
      len = (tag >> 2) + 1;
      if (pos + 4 > input.length) throw new Error("snappy: truncated copy4 offset");
      offset = (input[pos++] | (input[pos++] << 8) | (input[pos++] << 16) | (input[pos++] << 24)) >>> 0;
    }

    if (offset === 0 || offset > outPos) throw new Error("snappy: bad copy offset");
    if (outPos + len > outLen) throw new Error("snappy: copy past output end");
    // Copy one byte at a time: for overlapping copies (offset < len) each written
    // byte becomes source for the next, so a short pattern repeats forward. A bulk
    // copyWithin would read stale bytes and corrupt the run.
    let src = outPos - offset;
    for (let i = 0; i < len; i++) out[outPos++] = out[src++];
  }

  return { out, consumed: pos - start };
}

// Decode ONE raw Snappy stream starting at input[start]. Thin wrapper over
// decodeRaw for callers that only need the decoded bytes.
export function decompressRawSnappy(input: Uint8Array, start = 0): Uint8Array {
  return decodeRaw(input, start).out;
}

// A Snappy stream effectively always opens with a literal, so its first tag byte
// after the length varint has type 0 (tag & 0x03 === 0). Used as a cheap prefilter.
// Decoded lengths outside this window are treated as a bad varint, not a stream.
const MIN_DECODED = 256; // smaller than any real profiles backup block
const MAX_DECODED = 32 * 1024 * 1024; // 32 MB — a single LevelDB value won't exceed this
// Cap only the number of actual decode attempts (prefilter passes) so a
// pathological input full of valid-looking stream starts can't hang the worker.
// The O(1) prefilter itself runs over the whole buffer regardless — real dumps
// have very few plausible stream starts, so this cap is rarely approached.
const MAX_DECODE_ATTEMPTS = 4096;
const MARK = '"headers"'; // the ModHeader profile marker, our accept test

// Read the length varint at `pos`, returning [value, bytesConsumed], or null if it
// is malformed or runs off the end. Mirrors the decoder's preamble read but never
// throws — used only to size the prefilter's plausibility check.
function peekVarint(bytes: Uint8Array, pos: number): [number, number] | null {
  let value = 0;
  let shift = 0;
  let read = 0;
  for (;;) {
    if (pos + read >= bytes.length) return null;
    const b = bytes[pos + read++];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [value >>> 0, read];
    shift += 7;
    if (shift > 28) return null; // >5 bytes: not a valid 32-bit length varint
  }
}

// Find and decompress the Snappy-compressed ModHeader regions in a LevelDB dump.
// The dump has no clean file boundaries, so we walk candidate start offsets with a
// cheap prefilter (plausible length varint + a type-0 first tag), attempt a decode
// only when it passes, and keep a region only if its decoded text contains the
// "headers" marker. Returns the accepted decoded texts (Latin-1), possibly empty.
export function extractSnappyJsonTexts(bytes: Uint8Array): string[] {
  const out: string[] = [];
  const seen = new Set<string>(); // dedupe by decoded-content identity
  let decodeAttempts = 0;

  // The cheap O(1) prefilter walks the whole buffer — bounded by bytes.length —
  // so a valid block anywhere in a multi-MB dump is reached. Only the rare
  // prefilter passes (which trigger a real decode) are capped.
  let offset = 0;
  while (offset < bytes.length) {
    // Prefilter: a plausible uncompressed length immediately followed by a literal
    // (type 0) tag. Skips the vast majority of offsets without a decode attempt.
    const v = peekVarint(bytes, offset);
    if (!v) {
      offset++;
      continue;
    }
    const [decodedLen, varintBytes] = v;
    const firstTagIdx = offset + varintBytes;
    if (
      decodedLen < MIN_DECODED ||
      decodedLen > MAX_DECODED ||
      firstTagIdx >= bytes.length ||
      (bytes[firstTagIdx] & 0x03) !== 0
    ) {
      offset++;
      continue;
    }

    // Prefilter passed: this is a real decode attempt, so it counts against the cap.
    if (decodeAttempts++ >= MAX_DECODE_ATTEMPTS) break;

    let decoded: Uint8Array;
    let consumed: number;
    try {
      ({ out: decoded, consumed } = decodeRaw(bytes, offset));
    } catch {
      offset++; // bad copy offset / over-read throws fast within a few ops
      continue;
    }

    // Decode as UTF-8, identically to the plaintext path (scan.ts), so a recovered
    // profile with non-ASCII header values isn't corrupted; the ASCII marker below
    // survives either way.
    const text = new TextDecoder().decode(decoded);
    if (!text.includes(MARK)) {
      offset++;
      continue;
    }

    if (!seen.has(text)) {
      seen.add(text);
      out.push(text);
    }
    // Advance by the INPUT bytes this stream actually consumed so the cursor lands
    // exactly on the next packed block. ModHeader packs many backups adjacently;
    // overshooting by the (much larger) decoded length would skip them. `consumed`
    // is always >= 1 (the length varint alone), guaranteeing forward progress.
    offset += consumed;
  }

  return out;
}
