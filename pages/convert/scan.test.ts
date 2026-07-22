import { describe, it, expect } from "vitest";
import { bestSnapshot, dedupeProfiles, extractProfiles, pickNewer, type Snapshot } from "./scan";

// Synthetic ModHeader-shaped profiles only — never real exports (proprietary).
const profile = (title: string, headerValue = "v") => ({
  title,
  urlFilters: [],
  headers: [{ comment: "", enabled: true, name: "x-mock-response", value: headerValue }],
});

// A LevelDB record is roughly <key><framing><value>. We only rely on the bytes
// just before the value: backups are keyed by a 13-digit epoch-ms timestamp, the
// live value by the literal word `profiles`.
const backupRecord = (tsMs: number, arr: unknown[]) => `\x00\x03${tsMs}\x01${JSON.stringify(arr)}\xff`;
const liveRecord = (arr: unknown[]) => `\x00\x08profiles\x01${JSON.stringify(arr)}\xff`;
const noise = (n: number) => "\x00\xff{[".repeat(Math.ceil(n / 4)).slice(0, n);

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

describe("extractProfiles / dedupeProfiles", () => {
  it("dedupes structurally identical profiles", () => {
    expect(dedupeProfiles([profile("A"), profile("A"), profile("B")])).toHaveLength(2);
  });

  it("returns the best snapshot's profiles, deduped", () => {
    expect(extractProfiles(liveRecord([profile("A"), profile("A")]))).toHaveLength(1);
    expect(extractProfiles("not a dump")).toEqual([]);
  });
});
