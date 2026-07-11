# Header Handler Implementation Plan

**Goal:** Ship an MV3 Chrome extension that rewrites request headers via profiles of Set/Remove rules, with match-mode URL targeting, compressed import/export share strings, and a session-only side-panel live log of matched requests.

**Architecture:** WXT + Preact. `chrome.storage.sync` holds the `Config`; a shared matcher module drives both DNR rule compilation (`declarativeNetRequest.updateDynamicRules`) and the `webRequest`-observer reconstruction that feeds the live log. Popup = master switch + profile toggles; options page = full editor + import/export; side panel = live log. All logic that can be pure is pure and unit-tested with Vitest.

**Tech Stack:** WXT, Preact, TypeScript, `declarativeNetRequest`, non-blocking `webRequest` + `extraHeaders`, `sidePanel`, `lz-string`, WXT `storage`, Vitest + `@testing-library/preact`, `@resvg/resvg-js` for icons.

---

## File map (single responsibility each)

| Path | Responsibility |
|---|---|
| `wxt.config.ts` | Manifest fields, permissions, Preact vite hook |
| `src/types.ts` | `Config`, `Profile`, `HeaderRule`, `Matcher`, `MatchMode`, `HeaderOp` |
| `src/lib/matcher.ts` | `matcherToDnrCondition()`, `evaluateMatcher()`, url-filter escaping |
| `src/lib/share.ts` | `encodeShare()` / `decodeShare()` (lz-string, versioned prefix) |
| `src/lib/compile.ts` | `compileRules()` config→DNR rules; `diffRules()` |
| `src/lib/ids.ts` | uuid↔int id table (persisted counter) |
| `src/lib/storage.ts` | typed `configStore` (sync) + `logStore` (session) |
| `src/lib/log.ts` | in-memory ring buffer + reconstruction glue |
| `entrypoints/background.ts` | wire storage-change→compile, webRequest observer→log, sidePanel open |
| `entrypoints/popup/*` | master switch + profile toggles |
| `entrypoints/options/*` | profile/rule editors, matcher UI, import/export |
| `entrypoints/sidepanel/*` | live log view |
| `assets/icon.svg`, `scripts/generate-icons.mjs` | icon source + render |
| `docs/privacy.html`, `docs/screenshot-mock.html` | store assets |
| `.github/workflows/release.yml` | tag→build→zip→release |

---

## Task 1 — Author the UI design-mockup prompt (deliverable, no code)

**This is the first task the user asked for: a prompt to hand to Claude for mocking up the UI.** Save it to `docs/design-brief.md` so the eventual `docs/screenshot-mock.html` and the real Preact UI are built from one agreed visual spec.

Create `docs/design-brief.md` with exactly this content:

```markdown
# Header Handler — UI design brief (prompt for Claude / design tool)

Design a **dark-only** UI for a Chrome extension called **Header Handler** that adds,
overwrites, and removes HTTP **request** headers using shareable profiles. Produce
high-fidelity mockups for THREE surfaces. Dark theme only (no light mode). Palette:
bg `#0b0b0c`, surface `#141417`, border `#2a2a2e`, text `#e7e7e9`, muted `#8a8a90`,
accent `#6ea8fe`, success `#5fd08a`, danger `#f2777a`. System/ui sans-serif. Compact,
developer-tool density. `color-scheme: dark`.

## 1. Popup (360×420px, opens from toolbar icon)
- Top: app name "Header Handler" + a big master ON/OFF switch (accent when on).
- A scrollable list of PROFILES, each row = name + a toggle + a tiny count of enabled
  rules. Multiple can be on at once (toggles, not radios).
- Footer: "Open live log" button (opens side panel) + a gear "Options" link.
- Empty state when no profiles: a short line + "Create a profile" button.

## 2. Options page (full browser tab, max-width ~980px, centered)
- Left column: list of profiles (add "＋ New profile"; each selectable; shows enabled dot).
- Right column: the selected profile's editor:
  - Profile name field + enabled toggle.
  - Profile MATCHER row: a mode dropdown [Contains ▾ / Exact / Starts with / Ends with /
    Domain / Custom regex] + a value input. Show a subtle example hint under it that
    changes with the mode (e.g. Contains → "api.example.com", Regex → "^https://.*\\.dev/").
  - HEADER RULES table. Each row: enabled checkbox · op dropdown [Set / Remove] ·
    header-name input · value input (disabled/greyed when op = Remove) · an optional
    "override match" expander that reveals a per-row matcher (same control as the profile
    matcher) · delete button. "＋ Add header" at the bottom.
- Top-right of the page: "Import" and "Export ▾" (Export this profile / Export all).
  Import opens a modal with a paste box; on name collision show an "Overwrite ‹name›?"
  confirm with Overwrite / Cancel (and "apply to all" when importing a global bundle).
- Show a small validation error inline under a Custom-regex value when the regex is invalid.

## 3. Side panel (docked right, ~360px wide, full height)
- Header bar: "Live log" title + a "Clear" button + a small "session only" note.
- A reverse-chronological list of matched requests. Each entry:
  - Line 1: METHOD (coloured chip) + truncated URL (host emphasised) + time.
  - Line 2: small chips for each matched profile/rule name (accent).
  - Expandable: full request-header list for that request, with the header(s) our rules
    matched/added highlighted vs the rest muted.
- Empty state: "No matched requests yet — enable a profile and browse."

Deliver: one composite frame showing all three surfaces side by side over a faint mock
browser, plus a note of the exact hex tokens used, so it can be turned into
`docs/screenshot-mock.html` (1280×800) for the Chrome Web Store screenshot.
```

- **Commit:** `git add docs/design-brief.md && git commit -m "Add UI design brief for mockups"`

> After this task, hand `docs/design-brief.md` to Claude's design/mockup surface, review the visual, and only then proceed to build the UI in Tasks 8–11 against the agreed look.

---

## Task 2 — Scaffold the WXT + Preact project

1. In `/projects/header-handler`, run:
   ```bash
   npx wxt@latest init . --template vanilla
   ```
   When prompted for package manager choose npm. This writes `package.json`, `wxt.config.ts`, `entrypoints/`, `tsconfig.json`.
2. Add Preact + libs and dev deps:
   ```bash
   npm i preact lz-string
   npm i -D @preact/preset-vite vitest @testing-library/preact jsdom @resvg/resvg-js
   ```
3. Create `.npmrc` (WXT gotcha — scripts blocked in this environment) at repo root:
   ```
   ignore-scripts=true
   ```
   then run `npx wxt prepare` to generate `.wxt/`.
4. Overwrite `wxt.config.ts` with:
   ```ts
   import { defineConfig } from "wxt";
   import preact from "@preact/preset-vite";

   export default defineConfig({
     manifest: {
       name: "Header Handler",
       description: "Add, overwrite, and remove request headers with shareable profiles.",
       permissions: ["declarativeNetRequest", "webRequest", "storage", "sidePanel"],
       host_permissions: ["<all_urls>"],
       action: {},
       side_panel: { default_path: "sidepanel.html" },
     },
     vite: () => ({ plugins: [preact()] }),
   });
   ```
5. Ensure `tsconfig.json` extends WXT's and sets Preact JSX:
   ```jsonc
   {
     "extends": "./.wxt/tsconfig.json",
     "compilerOptions": {
       "jsx": "react-jsx",
       "jsxImportSource": "preact",
       "types": ["vitest/globals"]
     },
     "include": [".wxt/wxt.d.ts", "src", "entrypoints"]
   }
   ```
6. Add `vitest.config.ts`:
   ```ts
   import { defineConfig } from "vitest/config";
   export default defineConfig({
     test: { environment: "jsdom", globals: true },
   });
   ```
7. Add to `package.json` scripts:
   ```json
   "test": "vitest run",
   "test:watch": "vitest",
   "icons": "node scripts/generate-icons.mjs",
   "dev": "wxt",
   "build": "wxt build",
   "zip": "wxt zip"
   ```
8. Create `.gitignore`:
   ```
   node_modules/
   .output/
   .wxt/
   *.zip
   .claude/
   ```
- **Verify:** `npm run build` exits 0 (empty extension builds). `npx vitest run` reports "no test files" (exit 0).
- **Commit:** `git add -A && git commit -m "Scaffold WXT + Preact project"`

---

## Task 3 — Types

Create `src/types.ts`:
```ts
export type MatchMode = "contains" | "exact" | "starts" | "ends" | "domain" | "regex";

export interface Matcher {
  mode: MatchMode;
  value: string;
}

export type HeaderOp = "set" | "remove";

export interface HeaderRule {
  id: string;
  enabled: boolean;
  op: HeaderOp;
  name: string;
  value?: string;
  matcher?: Matcher;
}

export interface Profile {
  id: string;
  name: string;
  enabled: boolean;
  matcher: Matcher;
  rules: HeaderRule[];
}

export interface Config {
  version: 1;
  masterEnabled: boolean;
  profiles: Profile[];
}

export const emptyConfig = (): Config => ({ version: 1, masterEnabled: true, profiles: [] });
```
- **Verify:** `npx tsc --noEmit` exits 0.
- **Commit:** `git add src/types.ts && git commit -m "Add config types"`

---

## Task 4 — Matcher module (TDD)

1. Write `src/lib/matcher.test.ts`:
   ```ts
   import { describe, it, expect } from "vitest";
   import { matcherToDnrCondition, evaluateMatcher, escapeUrlFilter } from "./matcher";

   describe("escapeUrlFilter", () => {
     it("escapes DNR anchor/wildcard chars", () => {
       expect(escapeUrlFilter("a|b*c^d")).toBe("a\\|b\\*c\\^d");
     });
   });

   describe("matcherToDnrCondition", () => {
     it("contains → bare urlFilter", () => {
       expect(matcherToDnrCondition({ mode: "contains", value: "api.x.com" }))
         .toEqual({ urlFilter: "api.x.com" });
     });
     it("starts → leading anchor", () => {
       expect(matcherToDnrCondition({ mode: "starts", value: "https://x" }))
         .toEqual({ urlFilter: "|https://x" });
     });
     it("ends → trailing anchor", () => {
       expect(matcherToDnrCondition({ mode: "ends", value: "/graphql" }))
         .toEqual({ urlFilter: "/graphql|" });
     });
     it("exact → both anchors", () => {
       expect(matcherToDnrCondition({ mode: "exact", value: "https://x/y" }))
         .toEqual({ urlFilter: "|https://x/y|" });
     });
     it("domain → requestDomains", () => {
       expect(matcherToDnrCondition({ mode: "domain", value: "example.com" }))
         .toEqual({ requestDomains: ["example.com"] });
     });
     it("regex → regexFilter", () => {
       expect(matcherToDnrCondition({ mode: "regex", value: "^https://.*\\.dev/" }))
         .toEqual({ regexFilter: "^https://.*\\.dev/" });
     });
   });

   describe("evaluateMatcher", () => {
     const u = "https://api.example.com/v1/users?q=1";
     it("contains", () => {
       expect(evaluateMatcher({ mode: "contains", value: "example.com" }, u)).toBe(true);
       expect(evaluateMatcher({ mode: "contains", value: "nope" }, u)).toBe(false);
     });
     it("starts / ends / exact", () => {
       expect(evaluateMatcher({ mode: "starts", value: "https://api" }, u)).toBe(true);
       expect(evaluateMatcher({ mode: "ends", value: "q=1" }, u)).toBe(true);
       expect(evaluateMatcher({ mode: "exact", value: u }, u)).toBe(true);
       expect(evaluateMatcher({ mode: "exact", value: "https://api.example.com" }, u)).toBe(false);
     });
     it("domain matches host and subdomains", () => {
       expect(evaluateMatcher({ mode: "domain", value: "example.com" }, u)).toBe(true);
       expect(evaluateMatcher({ mode: "domain", value: "other.com" }, u)).toBe(false);
     });
     it("regex", () => {
       expect(evaluateMatcher({ mode: "regex", value: "^https://api\\." }, u)).toBe(true);
     });
     it("invalid regex is a non-match, never throws", () => {
       expect(evaluateMatcher({ mode: "regex", value: "(" }, u)).toBe(false);
     });
   });
   ```
2. Run `npx vitest run src/lib/matcher.test.ts` — confirm it fails (module missing).
3. Write `src/lib/matcher.ts`:
   ```ts
   import type { Matcher } from "../types";

   export function escapeUrlFilter(v: string): string {
     return v.replace(/[|*^]/g, (c) => "\\" + c);
   }

   export function matcherToDnrCondition(m: Matcher): chrome.declarativeNetRequest.RuleCondition {
     switch (m.mode) {
       case "contains": return { urlFilter: escapeUrlFilter(m.value) };
       case "starts":   return { urlFilter: "|" + escapeUrlFilter(m.value) };
       case "ends":     return { urlFilter: escapeUrlFilter(m.value) + "|" };
       case "exact":    return { urlFilter: "|" + escapeUrlFilter(m.value) + "|" };
       case "domain":   return { requestDomains: [m.value] };
       case "regex":    return { regexFilter: m.value };
     }
   }

   export function evaluateMatcher(m: Matcher, url: string): boolean {
     switch (m.mode) {
       case "contains": return url.includes(m.value);
       case "starts":   return url.startsWith(m.value);
       case "ends":     return url.endsWith(m.value);
       case "exact":    return url === m.value;
       case "domain": {
         try {
           const host = new URL(url).hostname;
           return host === m.value || host.endsWith("." + m.value);
         } catch { return false; }
       }
       case "regex": {
         try { return new RegExp(m.value).test(url); } catch { return false; }
       }
     }
   }
   ```
   Note: `escapeUrlFilter` test expects a single backslash before each char; `"\\" + c` produces exactly that.
4. Run `npx vitest run src/lib/matcher.test.ts` — confirm green.
- **Commit:** `git add src/lib/matcher.* && git commit -m "Add matcher translation + evaluation"`

---

## Task 5 — Share strings (TDD)

1. Write `src/lib/share.test.ts`:
   ```ts
   import { describe, it, expect } from "vitest";
   import { encodeShare, decodeShare } from "./share";
   import type { Profile, Config } from "../types";

   const profile: Profile = {
     id: "abc", name: "Auth", enabled: true,
     matcher: { mode: "domain", value: "example.com" },
     rules: [{ id: "r1", enabled: true, op: "set", name: "Authorization", value: "Bearer x" }],
   };

   describe("share round-trip", () => {
     it("single profile strips ids and round-trips content", () => {
       const s = encodeShare({ kind: "p", profile });
       expect(s.startsWith("HH1p")).toBe(true);
       const out = decodeShare(s);
       expect(out.kind).toBe("p");
       if (out.kind !== "p") throw new Error("kind");
       expect(out.profile.name).toBe("Auth");
       expect(out.profile.id).toBe("");           // stripped
       expect(out.profile.rules[0].id).toBe("");   // stripped
       expect(out.profile.rules[0].value).toBe("Bearer x");
     });
     it("global bundle round-trips all profiles", () => {
       const cfg: Config = { version: 1, masterEnabled: true, profiles: [profile] };
       const s = encodeShare({ kind: "g", config: cfg });
       expect(s.startsWith("HH1g")).toBe(true);
       const out = decodeShare(s);
       if (out.kind !== "g") throw new Error("kind");
       expect(out.profiles).toHaveLength(1);
       expect(out.profiles[0].name).toBe("Auth");
     });
     it("rejects bad prefix", () => {
       expect(() => decodeShare("XX1pblah")).toThrow(/format/i);
     });
     it("rejects unknown version", () => {
       expect(() => decodeShare("HH9pblah")).toThrow(/version/i);
     });
     it("rejects corrupt payload", () => {
       expect(() => decodeShare("HH1p@@@not-lz@@@")).toThrow();
     });
   });
   ```
2. Run it — confirm fails.
3. Write `src/lib/share.ts`:
   ```ts
   import LZString from "lz-string";
   import type { Profile, Config } from "../types";

   const PREFIX = "HH";
   const VERSION = "1";

   type EncodeInput =
     | { kind: "p"; profile: Profile }
     | { kind: "g"; config: Config };

   type DecodeOutput =
     | { kind: "p"; profile: Profile }
     | { kind: "g"; profiles: Profile[] };

   const stripProfile = (p: Profile): Profile => ({
     ...p, id: "",
     rules: p.rules.map((r) => ({ ...r, id: "" })),
   });

   export function encodeShare(input: EncodeInput): string {
     const payload = input.kind === "p"
       ? stripProfile(input.profile)
       : { profiles: input.config.profiles.map(stripProfile) };
     const body = LZString.compressToEncodedURIComponent(JSON.stringify(payload));
     return PREFIX + VERSION + input.kind + body;
   }

   export function decodeShare(s: string): DecodeOutput {
     if (!s.startsWith(PREFIX)) throw new Error("Unrecognized share format");
     const version = s[2];
     if (version !== VERSION) throw new Error(`Unsupported share version: ${version}`);
     const kind = s[3];
     const body = s.slice(4);
     const json = LZString.decompressFromEncodedURIComponent(body);
     if (!json) throw new Error("Corrupt share string");
     const parsed = JSON.parse(json);
     if (kind === "p") return { kind: "p", profile: parsed as Profile };
     if (kind === "g") return { kind: "g", profiles: (parsed.profiles ?? []) as Profile[] };
     throw new Error("Unknown share kind");
   }
   ```
4. Run — confirm green.
- **Commit:** `git add src/lib/share.* && git commit -m "Add versioned lz-string share codec"`

---

## Task 6 — Id mapping + rule compilation (TDD)

1. Write `src/lib/compile.test.ts`:
   ```ts
   import { describe, it, expect } from "vitest";
   import { compileRules, diffRules } from "./compile";
   import type { Config } from "../types";

   const cfg: Config = {
     version: 1, masterEnabled: true,
     profiles: [{
       id: "p1", name: "A", enabled: true,
       matcher: { mode: "domain", value: "example.com" },
       rules: [
         { id: "r1", enabled: true, op: "set", name: "X-A", value: "1" },
         { id: "r2", enabled: false, op: "set", name: "X-Off", value: "2" },
         { id: "r3", enabled: true, op: "remove", name: "Cookie" },
       ],
     }],
   };

   describe("compileRules", () => {
     it("emits one rule per enabled header rule with modifyHeaders action", () => {
       const rules = compileRules(cfg);
       expect(rules).toHaveLength(2); // r2 disabled skipped
       const set = rules.find((r) => r.action.requestHeaders?.[0].header === "x-a")!;
       expect(set.action.requestHeaders![0].operation).toBe("set");
       expect(set.action.requestHeaders![0].value).toBe("1");
       expect(set.condition).toEqual({ requestDomains: ["example.com"] });
       const rm = rules.find((r) => r.action.requestHeaders?.[0].header === "cookie")!;
       expect(rm.action.requestHeaders![0].operation).toBe("remove");
       expect(rm.action.requestHeaders![0].value).toBeUndefined();
     });
     it("uses per-rule matcher over profile matcher when present", () => {
       const c = structuredClone(cfg);
       c.profiles[0].rules[0].matcher = { mode: "contains", value: "/api" };
       expect(compileRules(c)[0].condition).toEqual({ urlFilter: "/api" });
     });
     it("returns [] when master disabled", () => {
       expect(compileRules({ ...cfg, masterEnabled: false })).toEqual([]);
     });
     it("priority increases with profile index", () => {
       const two = structuredClone(cfg);
       two.profiles.push({ ...cfg.profiles[0], id: "p2" });
       const rules = compileRules(two);
       const p1 = rules.find((r) => r.priority === 1);
       const p2 = rules.find((r) => r.priority === 2);
       expect(p1).toBeTruthy();
       expect(p2).toBeTruthy();
     });
   });

   describe("diffRules", () => {
     it("computes add/remove deltas by id", () => {
       const current = [{ id: 1 }, { id: 2 }] as chrome.declarativeNetRequest.Rule[];
       const next = [{ id: 2 }, { id: 3 }] as chrome.declarativeNetRequest.Rule[];
       const { addRules, removeRuleIds } = diffRules(current, next);
       expect(removeRuleIds).toEqual([1]);
       expect(addRules.map((r) => r.id)).toEqual([3]);
     });
   });
   ```
2. Run — fails.
3. Write `src/lib/compile.ts`:
   ```ts
   import type { Config } from "../types";
   import { matcherToDnrCondition } from "./matcher";

   // DNR needs integer ids; derive them deterministically from position so the same
   // config always compiles to the same id set (stable diffing across worker restarts).
   export function compileRules(cfg: Config): chrome.declarativeNetRequest.Rule[] {
     if (!cfg.masterEnabled) return [];
     const rules: chrome.declarativeNetRequest.Rule[] = [];
     let id = 1;
     cfg.profiles.forEach((profile, pIdx) => {
       if (!profile.enabled) return;
       for (const rule of profile.rules) {
         if (!rule.enabled) continue;
         const cond = matcherToDnrCondition(rule.matcher ?? profile.matcher);
         rules.push({
           id: id++,
           priority: 1 + pIdx,
           action: {
             type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
             requestHeaders: [{
               header: rule.name.toLowerCase(),
               operation: (rule.op === "set" ? "set" : "remove") as chrome.declarativeNetRequest.HeaderOperation,
               ...(rule.op === "set" ? { value: rule.value ?? "" } : {}),
             }],
           },
           condition: cond,
         });
       }
     });
     return rules;
   }

   export function diffRules(
     current: chrome.declarativeNetRequest.Rule[],
     next: chrome.declarativeNetRequest.Rule[],
   ): { addRules: chrome.declarativeNetRequest.Rule[]; removeRuleIds: number[] } {
     const nextIds = new Set(next.map((r) => r.id));
     const curIds = new Set(current.map((r) => r.id));
     return {
       removeRuleIds: current.filter((r) => !nextIds.has(r.id)).map((r) => r.id),
       addRules: next.filter((r) => !curIds.has(r.id)),
     };
   }
   ```
   Note: this positional-id scheme replaces a separate uuid↔int table (`src/lib/ids.ts` in the file map is folded in here — simpler, deterministic). Update the file map mentally: `ids.ts` is not needed.
4. Run — green.
- **Commit:** `git add src/lib/compile.* && git commit -m "Add DNR rule compilation + diffing"`

---

## Task 7 — Storage wrappers

Create `src/lib/storage.ts`:
```ts
import { storage } from "wxt/storage";
import type { Config } from "../types";
import { emptyConfig } from "../types";

export const configStore = storage.defineItem<Config>("sync:config", {
  fallback: emptyConfig(),
});

export interface LogEntry {
  ts: number;
  method: string;
  url: string;
  requestHeaders: { name: string; value: string }[];
  matchedRuleIds: string[]; // "profileId:ruleId"
}

// Session-only ring buffer; cleared on browser close.
export const logStore = storage.defineItem<LogEntry[]>("session:log", { fallback: [] });
export const LOG_CAP = 500;
```
- **Verify:** `npx tsc --noEmit` exits 0.
- **Commit:** `git add src/lib/storage.ts && git commit -m "Add typed storage wrappers"`

---

## Task 8 — Background: compile-on-change + log observer

Create `entrypoints/background.ts`:
```ts
import { configStore, logStore, LOG_CAP, type LogEntry } from "../src/lib/storage";
import { compileRules, diffRules } from "../src/lib/compile";
import { evaluateMatcher } from "../src/lib/matcher";
import type { Config } from "../src/types";

export default defineBackground(() => {
  async function recompile() {
    const cfg = await configStore.getValue();
    const next = compileRules(cfg);
    const current = await chrome.declarativeNetRequest.getDynamicRules();
    const { addRules, removeRuleIds } = diffRules(current, next);
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ addRules, removeRuleIds });
    } catch (e) {
      console.error("DNR update failed", e);
    }
  }

  configStore.watch(recompile);
  chrome.runtime.onInstalled.addListener(recompile);
  chrome.runtime.onStartup.addListener(recompile);
  recompile();

  // Open the side panel from the popup button.
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg?.type === "open-panel" && sender.tab?.windowId != null) {
      chrome.sidePanel.open({ windowId: sender.tab.windowId });
    }
  });

  // Live-log reconstruction (see ADR 0001): observe requests, re-run the matcher.
  function matchedRules(cfg: Config, url: string): string[] {
    if (!cfg.masterEnabled) return [];
    const hits: string[] = [];
    for (const p of cfg.profiles) {
      if (!p.enabled) continue;
      for (const r of p.rules) {
        if (!r.enabled) continue;
        if (evaluateMatcher(r.matcher ?? p.matcher, url)) hits.push(`${p.id}:${r.id}`);
      }
    }
    return hits;
  }

  chrome.webRequest.onSendHeaders.addListener(
    async (details) => {
      const cfg = await configStore.getValue();
      const matched = matchedRules(cfg, details.url);
      if (matched.length === 0) return;
      const entry: LogEntry = {
        ts: Date.now(),
        method: details.method,
        url: details.url,
        requestHeaders: (details.requestHeaders ?? []).map((h) => ({
          name: h.name, value: h.value ?? "",
        })),
        matchedRuleIds: matched,
      };
      const log = await logStore.getValue();
      await logStore.setValue([entry, ...log].slice(0, LOG_CAP));
    },
    { urls: ["<all_urls>"] },
    ["requestHeaders", "extraHeaders"],
  );
});
```
- **Verify:** `npm run build` exits 0; confirm `.output/chrome-mv3/manifest.json` lists `declarativeNetRequest`, `webRequest`, `sidePanel`, and `host_permissions: <all_urls>`.
- **Manual:** load `.output/chrome-mv3` unpacked; no errors in the service-worker console.
- **Commit:** `git add entrypoints/background.ts && git commit -m "Wire compile-on-change and log observer"`

---

## Task 9 — Popup (master switch + profile toggles)

1. Create `entrypoints/popup/index.html`:
   ```html
   <!doctype html>
   <html><head><meta charset="utf-8" /><link rel="stylesheet" href="./style.css" /></head>
   <body><div id="app"></div><script type="module" src="./main.tsx"></script></body></html>
   ```
2. Create `entrypoints/popup/style.css` with the dark tokens (bg `#0b0b0c`, surface `#141417`, accent `#6ea8fe`, etc.) and `:root { color-scheme: dark; }`. Keep it to the popup's 360px width.
3. Create `entrypoints/popup/main.tsx`:
   ```tsx
   import { render } from "preact";
   import { useEffect, useState } from "preact/hooks";
   import { configStore } from "../../src/lib/storage";
   import type { Config } from "../../src/types";

   function Popup() {
     const [cfg, setCfg] = useState<Config | null>(null);
     useEffect(() => {
       configStore.getValue().then(setCfg);
       const un = configStore.watch(setCfg);
       return un;
     }, []);
     if (!cfg) return null;

     const save = (next: Config) => { setCfg(next); configStore.setValue(next); };

     return (
       <div class="popup">
         <header>
           <span class="title">Header Handler</span>
           <label class="master">
             <input type="checkbox" checked={cfg.masterEnabled}
               onChange={(e) => save({ ...cfg, masterEnabled: (e.target as HTMLInputElement).checked })} />
             <span>{cfg.masterEnabled ? "On" : "Off"}</span>
           </label>
         </header>
         {cfg.profiles.length === 0 && <p class="empty">No profiles yet.</p>}
         <ul class="profiles">
           {cfg.profiles.map((p, i) => (
             <li key={p.id}>
               <input type="checkbox" checked={p.enabled}
                 onChange={(e) => {
                   const profiles = cfg.profiles.slice();
                   profiles[i] = { ...p, enabled: (e.target as HTMLInputElement).checked };
                   save({ ...cfg, profiles });
                 }} />
               <span class="name">{p.name}</span>
               <span class="count">{p.rules.filter((r) => r.enabled).length}</span>
             </li>
           ))}
         </ul>
         <footer>
           <button onClick={() => chrome.runtime.sendMessage({ type: "open-panel" })}>Live log</button>
           <button onClick={() => chrome.runtime.openOptionsPage()}>Options</button>
         </footer>
       </div>
     );
   }
   render(<Popup />, document.getElementById("app")!);
   ```
4. Set `options_ui` so `openOptionsPage()` works — add to `wxt.config.ts` manifest: `options_ui: { open_in_tab: true, page: "options.html" }` (WXT maps `entrypoints/options/index.html` → `options.html`).
- **Verify:** `npm run build` exits 0. Manual: popup opens, master toggle persists across reopen.
- **Commit:** `git add entrypoints/popup wxt.config.ts && git commit -m "Add popup with master switch and profile toggles"`

---

## Task 10 — Options page (editors + import/export)

Build `entrypoints/options/` (`index.html`, `style.css`, `main.tsx`). Requirements — implement against `docs/design-brief.md`:

- Loads `configStore`, renders the two-column layout (profile list left, editor right).
- "New profile" pushes `{ id: crypto.randomUUID(), name: "New profile", enabled: true, matcher: { mode: "contains", value: "" }, rules: [] }`.
- Profile editor: name input, enabled toggle, matcher control (`<select>` of the six modes + value input), header-rules table.
- Header row: enabled checkbox, op `<select>` (Set/Remove), name input, value input (disabled when op === "remove"), an "override match" toggle revealing a per-row matcher control, delete button. "Add header" pushes `{ id: crypto.randomUUID(), enabled: true, op: "set", name: "", value: "" }`.
- Custom-regex value validated with `try { new RegExp(v) } catch`; show inline error, block save of that field.
- Every mutation calls `configStore.setValue(next)` (the background `watch` recompiles).
- **Import/Export** using `src/lib/share.ts`:
  - "Export ▾": "Export this profile" → `encodeShare({ kind: "p", profile })`; "Export all" → `encodeShare({ kind: "g", config })`. Copy result to clipboard via `navigator.clipboard.writeText`.
  - "Import" modal: paste box → `decodeShare(s)`. On `kind: "p"`: assign fresh ids (`crypto.randomUUID()` for profile + each rule); if a profile with the same `name` exists, show an Overwrite/Cancel confirm (Overwrite replaces that profile's contents, keeping its id). On `kind: "g"`: iterate profiles, same collision prompt per name with an "apply to all" checkbox. Wrap `decodeShare` in try/catch and show the error message; never partially apply.

Add a component test `entrypoints/options/import.test.tsx` covering: importing a `p` string with a colliding name prompts overwrite; choosing Overwrite replaces contents; a corrupt string shows an error and mutates nothing. (Mock `configStore` with an in-memory value.)
- **Verify:** `npx vitest run` green; `npm run build` exits 0. Manual: create profile + Set header, export, delete profile, import, confirm it returns under the same name.
- **Commit:** `git add entrypoints/options && git commit -m "Add options page: editors + import/export"`

---

## Task 11 — Side panel (live log)

Build `entrypoints/sidepanel/` (`index.html`, `style.css`, `main.tsx`):

- Subscribe to `logStore` (`getValue` + `watch`) and render newest-first.
- Each entry: method chip + host-emphasised URL + relative time; a row of chips for `matchedRuleIds` resolved to `profileName › headerName` (look up against `configStore`); expandable full `requestHeaders` list with matched header names highlighted.
- "Clear" button → `logStore.setValue([])`.
- Empty state per the design brief.
- Because it's `storage.session`, no persistence handling is needed beyond the store.

Add `sidepanel.html` entrypoint (WXT maps `entrypoints/sidepanel/index.html` → `sidepanel.html`, matching `side_panel.default_path` in Task 2).
- **Verify:** `npm run build` exits 0. Manual: with a profile enabled targeting `httpbin.org`, open the panel, visit `https://httpbin.org/headers`, confirm an entry appears with the injected header highlighted; "Clear" empties it; reopening the browser starts empty.
- **Commit:** `git add entrypoints/sidepanel wxt.config.ts && git commit -m "Add side-panel live log"`

---

## Task 12 — Icons

1. Create `assets/icon.svg` — a simple dark-friendly glyph (e.g. an "H{}" mark in accent `#6ea8fe` on transparent).
2. Create `scripts/generate-icons.mjs`:
   ```js
   import { Resvg } from "@resvg/resvg-js";
   import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
   const svg = readFileSync("assets/icon.svg", "utf8");
   mkdirSync("public/icons", { recursive: true });
   for (const size of [16, 48, 128]) {
     const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
     writeFileSync(`public/icons/${size}.png`, png);
   }
   console.log("icons written");
   ```
3. Run `node scripts/generate-icons.mjs` (needs the dep installed without `ignore-scripts`; if blocked, run `npm rebuild @resvg/resvg-js` first). Commit the generated PNGs.
- **Verify:** `npm run build` exits 0 and WXT wires `icons` + `action.default_icon` from `public/icons`.
- **Commit:** `git add assets scripts public/icons && git commit -m "Add icon source and generated PNGs"`

---

## Task 13 — Store assets: privacy policy + screenshot mock

1. `docs/privacy.html` — plain-English policy: config stored in `chrome.storage.sync`; the live log reads request headers (including `Authorization`/`Cookie`) **only for requests matching your enabled rules**, holds them **in memory for the session**, never transmits or persists them, and clears on browser close. No analytics, no remote code.
2. `docs/screenshot-mock.html` — self-contained 1280×800 dark mock rendering all three surfaces over a faint fake browser, built from `docs/design-brief.md`. Open in Chrome, screenshot for the store listing.
- **Verify:** open both files in Chrome; privacy page reads cleanly, mock renders at 1280×800.
- **Commit:** `git add docs/privacy.html docs/screenshot-mock.html && git commit -m "Add privacy policy and screenshot mock"`

---

## Task 14 — Release workflow

Create `.github/workflows/release.yml` per the chrome-extension standard: trigger on `push: tags: ['v*']`, `permissions: contents: write`, fail if tag ≠ `package.json` version, build → `wxt zip` → also produce a repo-named folder-wrapped zip → `gh release create "$tag" "${name}-${ver}.zip" .output/*-chrome.zip --generate-notes --clobber`.
- **Verify:** `npx yaml-lint .github/workflows/release.yml` (or a local `act` dry-run if available) parses clean; do **not** push a tag in this task.
- **Commit:** `git add .github/workflows/release.yml && git commit -m "Add tag-driven release workflow"`

---

## Self-review notes

- **Spec coverage:** matcher modes (T4), Set/Remove (T3/T6), profiles + per-rule override precedence (T6), multiple concurrent profiles union (T6/T8), share single+global with overwrite prompt (T5/T10), lz-string versioned format (T5), side-panel session-only log via webRequest reconstruction (T7/T8/T11), popup master + toggles (T9), privacy disclosure (T13), release automation (T14), design-brief-first (T1). All spec sections map to a task.
- **Type consistency:** `Config/Profile/HeaderRule/Matcher/MatchMode/HeaderOp` defined once in T3 and imported everywhere; `LogEntry`/`matchedRuleIds` shaped as `"profileId:ruleId"` in T7 and produced identically in T8 and consumed in T11.
- **Deviation from file map:** `src/lib/ids.ts` dropped — T6 uses deterministic positional integer ids instead of a persisted uuid↔int table (simpler, stable across restarts).
- **Header casing:** DNR expects lowercase header names in `modifyHeaders`; T6 lowercases. Log display (T11) shows names as observed.
