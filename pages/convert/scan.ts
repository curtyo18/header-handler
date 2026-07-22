// Recover ModHeader profiles from arbitrary text: a pasted export, a downloaded
// .json, or the raw bytes of Chrome's storage LevelDB files. Shared by the main
// thread (small pastes) and the scan worker (multi-file dumps).
//
// Storage format (from ModHeader's source): the current profiles live in
// chrome.storage.local under the key `profiles` — stored as the whole array — and
// every change also writes a chrome.storage.sync cloud backup keyed by Date.now()
// (up to 50 kept). A raw dump therefore holds the live `profiles` value plus many
// timestamped backup snapshots of the same profiles as they were edited. The
// user's CURRENT state is the live `profiles` value; failing that, the newest
// backup. So we find each full profiles-array snapshot, note whether it is the
// authoritative `profiles`-keyed value and the epoch-ms timestamp before it, and
// return the best one — never the union of history (which would explode one
// edited profile into dozens of near-duplicates that collapse on import).

export function isProfileLike(p: unknown): boolean {
  return !!p && typeof p === "object" && Array.isArray((p as { headers?: unknown }).headers);
}

// Backward scan while looking for an array's opening bracket is bounded by this;
// a profile's "headers" key sits well within a few KB of its object start.
const BACK_WINDOW = 65_536;
// Cap the number of candidate '[' we fully validate per anchor, so a run of
// stray brackets in binary can't multiply into a long stall.
const MAX_CANDIDATES = 512;
// A whole profiles array can be large — many profiles, or big header values
// (e.g. a JSON mock-response). Allow up to this when reading the array end; a
// single stored value won't exceed it, and only one full parse runs per snapshot.
const MAX_ARRAY_SPAN = 8_388_608; // 8 MB
// ModHeader keys backups by a 13-digit epoch-ms timestamp; the live `profiles`
// key is the literal word. Both sit in the few bytes of LevelDB framing just
// before the value, so a small look-back window suffices.
const KEY_LOOKBACK = 24;
const MARK = '"headers"';

// End index of the JSON value (object or array) opening at `start`, tracking both
// {}/[] nesting and respecting strings/escapes. Bounded so binary can't scan far.
function matchJson(s: string, start: number, maxLen: number): number {
  const end = Math.min(s.length, start + maxLen);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < end; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return i;
    }
  }
  return -1;
}

// Does the '[' at `start` still enclose `markerIdx` (i.e. not close before it)?
// Cheap bounded check (start..markerIdx only) so we never have to fully match a
// multi-MB array just to confirm a candidate array bracket.
function spansMarker(text: string, start: number, markerIdx: number): boolean {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i <= markerIdx; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (--depth === 0) return false; // closed before reaching the marker
    }
  }
  return depth > 0;
}

// The '[' index of the profiles array enclosing a "headers" key, or -1. ModHeader
// stores every profile inside one array value, so we want that array (all current
// profiles), not the individual profile object.
function enclosingArrayStart(text: string, markerIdx: number): number {
  const lo = Math.max(0, markerIdx - BACK_WINDOW);
  let tries = 0;
  for (let s = markerIdx; s >= lo; s--) {
    if (text[s] !== "[") continue;
    if (++tries > MAX_CANDIDATES) break;
    if (spansMarker(text, s, markerIdx)) return s;
  }
  return -1;
}

// The epoch-ms timestamp ModHeader writes as the backup key just before a value,
// or 0 if none (e.g. the live `profiles` key, whose key is a word not digits).
function timestampBefore(text: string, at: number): number {
  const runs = text.slice(Math.max(0, at - KEY_LOOKBACK), at).match(/\d{12,}/g);
  return runs ? Number(runs[runs.length - 1]) : 0;
}

// Is this array the authoritative live value — keyed by the literal `profiles`
// storage key rather than a backup timestamp?
function isLiveProfilesValue(text: string, at: number): boolean {
  return text.slice(Math.max(0, at - KEY_LOOKBACK), at).includes("profiles");
}

export interface Snapshot {
  ts: number;
  live: boolean;
  profiles: unknown[];
}

// Prefer the authoritative live `profiles` value; then the newest backup. Used to
// combine per-file results in the worker without re-implementing the ranking.
export function pickNewer(a: Snapshot | null, b: Snapshot | null): Snapshot | null {
  if (!a) return b;
  if (!b) return a;
  if (a.live !== b.live) return a.live ? a : b;
  return a.ts >= b.ts ? a : b;
}

// Best profiles-array snapshot in `text`, or null if none is present as plain
// text (compressed/binary/encrypted regions yield nothing and are skipped).
export function bestSnapshot(text: string): Snapshot | null {
  let best: { live: boolean; ts: number; at: number; profiles: unknown[] } | null = null;
  const seenStart = new Set<number>();
  let from = 0;
  for (;;) {
    const h = text.indexOf(MARK, from);
    if (h === -1) break;
    from = h + MARK.length;

    const start = enclosingArrayStart(text, h);
    if (start < 0 || seenStart.has(start)) continue;
    seenStart.add(start);

    const end = matchJson(text, start, MAX_ARRAY_SPAN);
    if (end < 0) continue;
    let arr: unknown;
    try {
      arr = JSON.parse(text.slice(start, end + 1));
    } catch {
      continue; // not valid JSON at this bracket — a coincidental '[' in binary
    }
    if (!Array.isArray(arr)) continue;
    const profiles = arr.filter(isProfileLike);
    if (profiles.length === 0) continue;

    const live = isLiveProfilesValue(text, start);
    const ts = timestampBefore(text, start);
    // Rank: authoritative live value first, then newest timestamp, then later
    // position in the bytes as a final tiebreak.
    const beatsBest =
      !best ||
      (live !== best.live ? live : ts !== best.ts ? ts > best.ts : start > best.at);
    if (beatsBest) best = { live, ts, at: start, profiles };
  }
  return best ? { ts: best.ts, live: best.live, profiles: best.profiles } : null;
}

// Drop structurally-identical profiles (same fields), e.g. a profile present both
// in the live value and a same-content backup captured in one pass.
export function dedupeProfiles(profiles: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const p of profiles) {
    const key = JSON.stringify(p);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

// Single-text convenience (paste path): the best snapshot's profiles.
export function extractProfiles(text: string): unknown[] {
  const snap = bestSnapshot(text);
  return snap ? dedupeProfiles(snap.profiles) : [];
}
