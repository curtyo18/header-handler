import { describe, it, expect } from "vitest";
import { bestSnapshot, dedupeProfiles, pickNewer, scanBytes, type Snapshot } from "./scan";

// Synthetic ModHeader-shaped profiles only — never real exports (proprietary).
const profile = (title: string, headerValue = "v") => ({
  title,
  urlFilters: [],
  headers: [{ comment: "", enabled: true, name: "x-mock-response", value: headerValue }],
});

// Same shape, but a caller-chosen header NAME so a test can assert a distinctive
// header survived a compressed-only recovery.
const namedProfile = (title: string, headerName: string) => ({
  title,
  urlFilters: [],
  headers: [{ comment: "", enabled: true, name: headerName, value: "v" }],
});

// A LevelDB record is roughly <key><framing><value>. We only rely on the bytes
// just before the value: backups are keyed by a 13-digit epoch-ms timestamp, the
// live value by the literal word `profiles`.
const backupRecord = (tsMs: number, arr: unknown[]) => `\x00\x03${tsMs}\x01${JSON.stringify(arr)}\xff`;
const liveRecord = (arr: unknown[]) => `\x00\x08profiles\x01${JSON.stringify(arr)}\xff`;
const noise = (n: number) => "\x00\xff{[".repeat(Math.ceil(n / 4)).slice(0, n);

// Latin-1 bytes of a string (each char -> its low byte). All our synthetic
// records are within 0..255, so this reproduces the record's raw bytes.
const toBytes = (s: string) => {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};

const concatBytes = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

// A minimal greedy Snappy raw compressor (SYNTHETIC test infra only). It emits the
// length varint then literal/copy2 ops, back-referencing repeated 4-byte runs so
// the marker text is genuinely fragmented in the compressed bytes — i.e. it does
// NOT appear verbatim in the byte stream, which is exactly what makes a compressed
// block invisible to the plaintext scan. Decodes cleanly via decompressRawSnappy.
function compressRawSnappy(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let n = input.length;
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);

  const emitLiteral = (start: number, end: number) => {
    const len = end - start;
    if (len === 0) return;
    const x = len - 1;
    if (x < 60) {
      out.push(x << 2); // type 0, len-1 inline
    } else {
      const k = x <= 0xff ? 1 : x <= 0xffff ? 2 : x <= 0xffffff ? 3 : 4;
      out.push((59 + k) << 2);
      for (let i = 0; i < k; i++) out.push((x >>> (8 * i)) & 0xff);
    }
    for (let i = start; i < end; i++) out.push(input[i]);
  };

  const table = new Map<string, number>(); // last index of each 4-byte run
  let i = 0;
  let litStart = 0;
  while (i + 4 <= input.length) {
    const key = String.fromCharCode(input[i], input[i + 1], input[i + 2], input[i + 3]);
    const cand = table.get(key);
    table.set(key, i);
    if (cand !== undefined && i - cand <= 0xffff) {
      let len = 4;
      while (i + len < input.length && len < 64 && input[cand + len] === input[i + len]) len++;
      const offset = i - cand;
      emitLiteral(litStart, i);
      out.push(((len - 1) << 2) | 2, offset & 0xff, (offset >> 8) & 0xff); // copy2
      i += len;
      litStart = i;
    } else {
      i++;
    }
  }
  emitLiteral(litStart, input.length);
  return new Uint8Array(out);
}

const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("bestSnapshot", () => {
  it("returns the newest backup among several history snapshots", () => {
    const blob =
      noise(500) +
      backupRecord(1777761863433, [profile("Profile 1", "fsp")]) +
      backupRecord(1777761999999, [profile("Profile 1", "fsp:default")]) +
      backupRecord(1777761900000, [profile("Profile 1", "fsp:d")]) +
      noise(500);
    const snap = bestSnapshot(blob) as Snapshot;
    expect(snap.profiles).toHaveLength(1);
    expect((snap.profiles[0] as { headers: { value: string }[] }).headers[0].value).toBe("fsp:default");
  });

  it("prefers the live `profiles` value even when a backup has a newer timestamp", () => {
    // The live value carries no timestamp (key is a word), so a naive newest-ts
    // rule would wrongly pick the stale backup. Live must win regardless.
    const blob =
      backupRecord(1999999999999, [profile("STALE-backup")]) + liveRecord([profile("LIVE-current")]);
    const snap = bestSnapshot(blob) as Snapshot;
    expect(snap.live).toBe(true);
    expect((snap.profiles[0] as { title: string }).title).toBe("LIVE-current");
  });

  it("recovers a profiles array larger than the per-brace scan cap (>256 KB)", () => {
    const many = Array.from({ length: 400 }, (_, i) => profile(`Profile ${i}`, "x".repeat(800)));
    const json = JSON.stringify(many);
    expect(json.length).toBeGreaterThan(262_144);
    const snap = bestSnapshot(noise(1000) + liveRecord(many) + noise(1000)) as Snapshot;
    expect(snap.profiles).toHaveLength(400);
  });

  it("returns every profile in the chosen snapshot, not just the first", () => {
    const arr = [profile("A"), profile("B"), profile("C")];
    const snap = bestSnapshot(backupRecord(1777761863433, arr)) as Snapshot;
    expect((snap.profiles as { title: string }[]).map((p) => p.title)).toEqual(["A", "B", "C"]);
  });

  it("is not fooled by a header value that contains the text \"headers\"", () => {
    const p = {
      title: "Tricky",
      urlFilters: [],
      headers: [{ enabled: true, name: "x", value: 'say "headers" and { and [' }],
    };
    const snap = bestSnapshot(liveRecord([p])) as Snapshot;
    expect(snap.profiles).toHaveLength(1);
    expect((snap.profiles[0] as { headers: { value: string }[] }).headers[0].value).toBe('say "headers" and { and [');
  });

  it("returns null on binary with no readable profiles array", () => {
    expect(bestSnapshot(noise(50_000) + '{"headers":')).toBeNull();
    expect(bestSnapshot("")).toBeNull();
  });
});

describe("scanBytes", () => {
  it("recovers a profile that exists only inside a Snappy-compressed block", () => {
    // The distinctive header name lives only in the compressed value; the plaintext
    // byte view never contains the marker verbatim, so bestSnapshot alone sees nothing.
    const decoded = liveRecord([namedProfile("Buried", "x-compressed-recovery")]) + " ".repeat(300);
    const bytes = compressRawSnappy(toBytes(decoded));

    expect(bestSnapshot(decodeUtf8(bytes))).toBeNull(); // invisible to the plaintext scan

    const snap = scanBytes(bytes) as Snapshot;
    const names = (snap.profiles as { headers: { name: string }[] }[]).flatMap((p) =>
      p.headers.map((h) => h.name),
    );
    expect(names).toContain("x-compressed-recovery");
  });

  it("prefers a live plaintext value over an older compressed backup", () => {
    const live = toBytes(liveRecord([namedProfile("LIVE-current", "x-live")]));
    const backup = compressRawSnappy(
      toBytes(backupRecord(1500000000000, [namedProfile("OLD-backup", "x-old")]) + " ".repeat(300)),
    );
    const snap = scanBytes(concatBytes(live, backup)) as Snapshot;
    expect(snap.live).toBe(true);
    expect((snap.profiles[0] as { title: string }).title).toBe("LIVE-current");
  });

  it("matches bestSnapshot on plain ASCII input with no compressed data", () => {
    const text = JSON.stringify({
      version: 2,
      profiles: [namedProfile("Work", "x-a"), namedProfile("Mocks", "x-b")],
    });
    expect(scanBytes(toBytes(text))).toEqual(bestSnapshot(text));
  });
});

describe("pickNewer", () => {
  const live = { ts: 0, live: true, profiles: [profile("live")] };
  const oldBackup = { ts: 100, live: false, profiles: [profile("old")] };
  const newBackup = { ts: 200, live: false, profiles: [profile("new")] };

  it("prefers the live value over any backup", () => {
    expect(pickNewer(newBackup, live)).toBe(live);
    expect(pickNewer(live, newBackup)).toBe(live);
  });

  it("prefers the newer backup when neither is live", () => {
    expect(pickNewer(oldBackup, newBackup)).toBe(newBackup);
    expect(pickNewer(newBackup, oldBackup)).toBe(newBackup);
  });

  it("handles nulls", () => {
    expect(pickNewer(null, newBackup)).toBe(newBackup);
    expect(pickNewer(live, null)).toBe(live);
    expect(pickNewer(null, null)).toBeNull();
  });
});

describe("dedupeProfiles", () => {
  it("dedupes structurally identical profiles", () => {
    expect(dedupeProfiles([profile("A"), profile("A"), profile("B")])).toHaveLength(2);
  });
});

describe("bestSnapshot on a plain export (no LevelDB framing)", () => {
  // The single recovery flow relies on the dump scanner also handling a clean
  // {version,profiles:[…]} export dropped on the box — assert that directly.
  it("recovers profiles from a clean ModHeader .json export", () => {
    const exported = JSON.stringify({ version: 2, profiles: [profile("Work"), profile("Mocks")] });
    const snap = bestSnapshot(exported) as Snapshot;
    expect((snap.profiles as { title: string }[]).map((p) => p.title)).toEqual(["Work", "Mocks"]);
  });

  it("returns null when there is no profiles array at all", () => {
    expect(bestSnapshot("not a dump")).toBeNull();
  });
});
