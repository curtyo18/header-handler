// Pull ModHeader profiles out of arbitrary text: a pasted export, a downloaded
// .json, or the raw bytes of Chrome's storage LevelDB files (where storage.local
// values live as JSON strings). Shared by the main thread (small pastes) and the
// scan worker (multi-MB dumps).
//
// We anchor on the "headers" key rather than trying every '{': a ModHeader
// profile always contains one, so on a 50+ MB dump — most of which is compressed
// or encrypted binary with no readable JSON — we only attempt to parse the few
// real objects instead of every stray brace. Compressed/binary regions yield no
// anchor and are skipped; this never reconstructs profiles that aren't present as
// plain text.

export function isProfileLike(p: unknown): boolean {
  return !!p && typeof p === "object" && Array.isArray((p as { headers?: unknown }).headers);
}

// Index of the '}' that closes the '{' at `start`, respecting JSON strings and
// escapes. Bounded so a run of binary that opens a brace can't scan far — a
// single ModHeader profile is well under this.
export function matchBrace(s: string, start: number, maxLen = 262_144): number {
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
    else if (c === "{") depth++;
    else if (c === "}") {
      if (--depth === 0) return i;
    }
  }
  return -1;
}

const MARK = '"headers"';
// A profile object rarely spans more than a few KB before its "headers" key;
// bound the backward search so a false anchor in binary can't scan far.
const BACK_WINDOW = 65_536;
// The real opening brace sits just before the marker, so a handful of candidates
// suffice. Capping the attempts stops a run of unbalanced '{' in binary from
// multiplying BACK_WINDOW × matchBrace into a minutes-long stall per anchor.
const MAX_CANDIDATES = 256;

// Find the object enclosing a "headers" key at markerIdx: walk back to the
// nearest '{' that JSON-parses into a profile (or export wrapper). Nearest-first
// so title/value strings containing '{' fall through to an earlier brace.
function parseEnclosing(text: string, markerIdx: number): unknown {
  const lo = Math.max(0, markerIdx - BACK_WINDOW);
  let tries = 0;
  for (let s = markerIdx; s >= lo; s--) {
    if (text[s] !== "{") continue;
    if (++tries > MAX_CANDIDATES) break;
    const end = matchBrace(text, s);
    if (end < markerIdx) continue; // must actually enclose the marker
    try {
      const obj = JSON.parse(text.slice(s, end + 1));
      if (isProfileLike(obj) || Array.isArray((obj as { profiles?: unknown }).profiles)) return obj;
    } catch {
      /* not this brace — try an earlier one */
    }
  }
  return null;
}

// Drop profiles that are structurally identical (same fields across profiles
// that appear in both an export wrapper and a loose copy in the same bytes).
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

export function extractProfiles(text: string): unknown[] {
  const profiles: unknown[] = [];
  let from = 0;
  for (;;) {
    const h = text.indexOf(MARK, from);
    if (h === -1) break;
    from = h + MARK.length;
    const obj = parseEnclosing(text, h);
    if (!obj) continue;
    const nested = (obj as { profiles?: unknown }).profiles;
    if (Array.isArray(nested)) {
      for (const p of nested) if (isProfileLike(p)) profiles.push(p);
    } else if (isProfileLike(obj)) {
      profiles.push(obj);
    }
  }
  return dedupeProfiles(profiles);
}
