/// <reference lib="webworker" />
import { bestSnapshot, dedupeProfiles, pickNewer, type Snapshot } from "./scan";

// Reads and scans the dropped files off the main thread so a large storage dump
// never freezes the page. Each ModHeader save writes the whole profiles array and
// the LevelDB keeps every past write, so we take the single best snapshot across
// all files (authoritative live value, else newest backup) — the user's current
// state — not the union.
declare const self: DedicatedWorkerGlobalScope;

// Skip anything implausibly large for a settings file — a runaway cache or the
// whole IndexedDB blob — so one giant file can't stall the scan.
const MAX_FILE_BYTES = 256 * 1024 * 1024;

self.onmessage = async (e: MessageEvent<{ files: File[] }>) => {
  const { files } = e.data;
  let best: Snapshot | null = null;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    self.postMessage({ type: "progress", scanned: i, total: files.length });
    if (file.size === 0 || file.size > MAX_FILE_BYTES) continue;
    let text: string;
    try {
      text = await file.text();
    } catch {
      continue; // unreadable file (permissions / vanished) — skip it, scan the rest
    }
    best = pickNewer(best, bestSnapshot(text));
  }

  self.postMessage({ type: "done", profiles: best ? dedupeProfiles(best.profiles) : [] });
};
