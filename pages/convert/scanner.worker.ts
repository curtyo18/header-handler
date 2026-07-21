/// <reference lib="webworker" />
import { dedupeProfiles, extractProfiles } from "./scan";

// Reads and scans the dropped files off the main thread so a large storage dump
// (tens of MB) never freezes the page. Posts progress per file, then the deduped
// raw profiles.
declare const self: DedicatedWorkerGlobalScope;

// Skip anything implausibly large for a storage file — a runaway cache or the
// whole IndexedDB blob — so one giant file can't stall the scan.
const MAX_FILE_BYTES = 256 * 1024 * 1024;

self.onmessage = async (e: MessageEvent<{ files: File[] }>) => {
  const { files } = e.data;
  const profiles: unknown[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    self.postMessage({ type: "progress", scanned: i, total: files.length });
    if (file.size === 0 || file.size > MAX_FILE_BYTES) continue;
    let text: string;
    try {
      text = await file.text();
    } catch {
      continue;
    }
    for (const p of extractProfiles(text)) profiles.push(p);
  }

  self.postMessage({ type: "done", profiles: dedupeProfiles(profiles) });
};
