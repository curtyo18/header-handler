import { convertModHeader } from "../../src/lib/modheader";
import { encodeShare } from "../../src/lib/share";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const output = $<HTMLTextAreaElement>("output");
const errorEl = $<HTMLParagraphElement>("error");
const resultEl = $<HTMLElement>("result");
const summaryEl = $<HTMLParagraphElement>("summary");
const warningsEl = $<HTMLUListElement>("warnings");
const copiedEl = $<HTMLSpanElement>("copied");
const scanOverlayEl = $<HTMLElement>("scanOverlay");
const scanStatusEl = $<HTMLParagraphElement>("scanStatus");

// Full-page overlay + spinner while a scan runs; a subtle inline text update read
// as "nothing is happening", so this makes the processing state unmistakable.
function showScanning(text: string) {
  // Unhide first, then set text: an aria-live region mutated while still hidden
  // often isn't announced when it later appears, so reveal it before the update.
  scanOverlayEl.hidden = false;
  scanStatusEl.textContent = text;
}
function hideScanning() {
  scanOverlayEl.hidden = true;
}

// ModHeader's Chrome extension id — its storage folder is named after it.
const EXT_ID = "idgpnmonknjnojddfkpgkljpfnnfcklj";

// ── OS-specific instructions ────────────────────────────────────────────────
// macOS and Windows differ only in the storage path and modifier keys, so the
// page carries both and shows one. Detection is a guess (userAgentData is
// Chromium-only) and the reader may recover on a different machine, hence the
// manual switch.
// The browser's User Data root, not a guessed profile path: ModHeader's data can
// live under Default OR Profile 1/2/… (one per Chrome profile), so we point users
// at the root and have them search it for EXT_ID.
const USER_DATA_PATH = {
  mac: `~/Library/Application Support/Google/Chrome`,
  win: `%LOCALAPPDATA%\\Google\\Chrome\\User Data`,
} as const;

// Where the command writes the dump — offered as a copy-able path so users can
// paste it straight into the file-open dialog (macOS ⇧⌘G expands ~; the Windows
// dialog expands %TEMP%). Windows uses %TEMP% not the Desktop: with OneDrive
// "back up Desktop" on (the Win11 default) the real Desktop is under OneDrive and
// $HOME\Desktop may not exist, so a Desktop write silently fails. %TEMP% always
// resolves and is never cloud-synced.
const DUMP_PATH = {
  mac: `~/Desktop/modheader-dump.txt`,
  win: `%TEMP%\\modheader-dump.txt`,
} as const;

function setOs(os: "mac" | "win") {
  document.body.dataset.os = os;
  $<HTMLButtonElement>("os-mac").setAttribute("aria-pressed", String(os === "mac"));
  $<HTMLButtonElement>("os-win").setAttribute("aria-pressed", String(os === "win"));
  $<HTMLElement>("path").textContent = USER_DATA_PATH[os];
  $<HTMLElement>("dumppath").textContent = DUMP_PATH[os];
}

const uaPlatform =
  (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
setOs(/mac/i.test(uaPlatform) ? "mac" : "win");
$<HTMLButtonElement>("os-mac").addEventListener("click", () => setOs("mac"));
$<HTMLButtonElement>("os-win").addEventListener("click", () => setOs("win"));

// Commands that dump ModHeader's *Extension Settings stores (Local holds the
// current `profiles`; Sync/Managed hold cloud/policy copies) across Chrome/Edge/
// Brave into modheader-dump.txt (the Desktop on macOS, %TEMP% on Windows). We
// deliberately skip the IndexedDB folder — that's the pulled build's harvested-
// header cache (100 MB+), not profiles — which also keeps the dump small. Read-
// only, the extension never executes. Formatted over multiple lines (bash "\"
// continuations; PowerShell trailing-pipe continuations) so a long one-liner
// doesn't read as sketchy. Kept in JS so the extension id is single-sourced.
//
// Both platforms must copy the stores byte-for-byte: they're binary LevelDB
// (Snappy-compressed blocks, varint framing) and the profile JSON lives inside
// as raw bytes. macOS `cat` is byte-exact. On Windows we stream ReadAllBytes ->
// FileStream (NOT ReadAllText/Set-Content, which decode as text and replace
// every non-UTF-8 byte with U+FFFD — irreversibly shredding the JSON payloads).
const CMD = {
  mac: [
    `find ~/Library/Application\\ Support -type f \\`,
    `  -path '*Extension Settings/${EXT_ID}*' \\`,
    `  -exec cat {} + 2>/dev/null \\`,
    `  > ~/Desktop/modheader-dump.txt`,
    `echo "Saved $(wc -c < ~/Desktop/modheader-dump.txt) bytes to ~/Desktop/modheader-dump.txt"`,
  ].join("\n"),
  win: [
    `$id  = '${EXT_ID}'`,
    `$out = Join-Path $env:TEMP 'modheader-dump.txt'`,
    ``,
    `$fs = [IO.File]::Create($out)`,
    `try {`,
    `  Get-ChildItem $env:LOCALAPPDATA, $env:APPDATA -Recurse -Directory -Filter $id -EA SilentlyContinue |`,
    `    Where-Object { $_.Parent.Name -like '*Extension Settings' } |`,
    `    ForEach-Object { Get-ChildItem $_.FullName -File -EA SilentlyContinue } |`,
    `    ForEach-Object { try { $b = [IO.File]::ReadAllBytes($_.FullName); $fs.Write($b, 0, $b.Length) } catch {} }`,
    `} finally { $fs.Close() }`,
    ``,
    `"Saved $([int](Get-Item $out -EA SilentlyContinue).Length) bytes to $out"`,
  ].join("\n"),
} as const;
$<HTMLElement>("cmd-mac").textContent = CMD.mac;
$<HTMLElement>("cmd-win").textContent = CMD.win;

// Every copy button carries data-copy="<id of the element whose text to copy>",
// so one handler covers commands, paths and the extension id with consistent
// "copied" feedback. writeText can reject (denied permission / insecure context);
// swallow it rather than leave an unhandled rejection or a stuck label.
const COPY_FEEDBACK_MS = 1200;
for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
  btn.addEventListener("click", async () => {
    const key = btn.dataset.copy!;
    const target = document.getElementById(key);
    // Commands get a trailing newline so pasting runs the final line without a
    // manual Enter; paths/id are copied verbatim.
    const text = (target?.textContent ?? "") + (key.startsWith("cmd-") ? "\n" : "");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    const prev = btn.textContent;
    btn.textContent = "copied";
    setTimeout(() => (btn.textContent = prev), COPY_FEEDBACK_MS);
  });
}

// ── Rendering ───────────────────────────────────────────────────────────────
function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  resultEl.hidden = true;
}

function render(config: import("../../src/types").Config, warnings: string[]) {
  errorEl.hidden = true;
  copiedEl.hidden = true;
  output.value = encodeShare({ kind: "g", config });

  const profileCount = config.profiles.length;
  const ruleCount = config.profiles.reduce((n, p) => n + p.rules.length, 0);
  summaryEl.textContent =
    `Converted ${profileCount} profile${profileCount === 1 ? "" : "s"} ` +
    `(${ruleCount} header rule${ruleCount === 1 ? "" : "s"}). ` +
    `All profiles are imported disabled — review scope, then enable them in the extension.`;

  warningsEl.replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement("li");
      li.textContent = `⚠ ${w}`;
      return li;
    }),
  );

  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Run any parsed ModHeader-shaped value through the converter and render it.
function convertAndRender(parsed: unknown) {
  try {
    const { config, warnings } = convertModHeader(parsed);
    render(config, warnings);
  } catch (e) {
    showError((e as Error).message);
  }
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// Dump / folder recovery: scan the dropped files in a worker so a large storage
// dump (tens of MB of mostly binary) never freezes the page. LOCK is empty and
// .ldb blocks may be Snappy-compressed (no plain JSON) — those contribute
// nothing; recent writes in the uncompressed .log usually hit.
type ScanMsg = { type: "progress"; scanned: number; total: number } | { type: "done"; profiles: unknown[] };

// One scan at a time: a second drop/pick supersedes an in-flight one. Without
// this, two workers race and whichever finishes last clobbers the result panel.
let activeWorker: Worker | null = null;

function recoverFromFiles(files: File[]) {
  errorEl.hidden = true;
  resultEl.hidden = true;
  showScanning(`Scanning ${files.length} file${files.length === 1 ? "" : "s"}…`);

  activeWorker?.terminate();
  const worker = new Worker(new URL("./scanner.worker.ts", import.meta.url), { type: "module" });
  activeWorker = worker;

  worker.onmessage = (e: MessageEvent<ScanMsg>) => {
    if (worker !== activeWorker) return; // superseded by a newer scan
    const msg = e.data;
    if (msg.type === "progress") {
      showScanning(`Scanning… (${msg.scanned}/${msg.total})`);
      return;
    }
    worker.terminate();
    activeWorker = null;
    hideScanning();
    if (msg.profiles.length === 0) {
      showError(
        "No ModHeader profiles found in that dump. If the command reported 0 bytes, fully quit the browser and " +
          "re-run it. Otherwise the profiles may be in compressed storage — try dropping the whole Extension " +
          "Settings folder (see “find the folder by hand” above) instead of the dump file.",
      );
      return;
    }
    convertAndRender({ version: 2, profiles: msg.profiles });
  };
  worker.onerror = () => {
    if (worker !== activeWorker) return;
    worker.terminate();
    activeWorker = null;
    hideScanning();
    showError("Something went wrong scanning those files. Reload the page and try again.");
  };
  worker.postMessage({ files });
}

// Gather every file under a dropped item, recursing into directories.
async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items ?? [])
    .map((it) => (it as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null }).webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (entries.length === 0) return Array.from(dt.files ?? []);

  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const readBatch = () => new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      let batch: FileSystemEntry[];
      do {
        batch = await readBatch();
        for (const e of batch) await walk(e);
      } while (batch.length > 0);
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

const folderInputEl = $<HTMLInputElement>("folderInput");
$<HTMLButtonElement>("folderPick").addEventListener("click", () => folderInputEl.click());
folderInputEl.addEventListener("change", () => {
  const files = folderInputEl.files ? Array.from(folderInputEl.files) : [];
  if (files.length > 0) void recoverFromFiles(files);
  folderInputEl.value = "";
});

const fileInputEl = $<HTMLInputElement>("fileInput");
$<HTMLButtonElement>("filePick").addEventListener("click", () => fileInputEl.click());
fileInputEl.addEventListener("change", () => {
  const file = fileInputEl.files?.[0];
  if (file) void recoverFromFiles([file]);
  fileInputEl.value = "";
});

// ── Drag & drop wiring ──────────────────────────────────────────────────────
function attachDrop(el: HTMLElement, onDrop: (dt: DataTransfer) => void) {
  for (const type of ["dragenter", "dragover"]) {
    el.addEventListener(type, (e) => {
      e.preventDefault();
      el.classList.add("drop-active");
    });
  }
  for (const type of ["dragleave", "dragend"]) {
    el.addEventListener(type, () => el.classList.remove("drop-active"));
  }
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("drop-active");
    const dt = (e as DragEvent).dataTransfer;
    if (dt) onDrop(dt);
  });
}

attachDrop($<HTMLDivElement>("folderDrop"), (dt) => {
  void filesFromDataTransfer(dt).then((files) => {
    if (files.length > 0) recoverFromFiles(files);
  });
});

$<HTMLButtonElement>("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(output.value);
  } catch {
    return;
  }
  copiedEl.hidden = false;
});
