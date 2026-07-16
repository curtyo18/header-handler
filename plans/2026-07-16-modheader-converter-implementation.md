# ModHeader Converter + Store-Docs Correction Implementation Plan

**Goal:** Correct the store listing to reflect Chrome's no-data-declared approval, and add a client-side GitHub Pages page that converts a ModHeader export into a Header Handler `HH1g` global share string.

**Architecture:** Part A edits `docs/store/listing.md` only. Part B adds a pure `convertModHeader` mapper in the extension source (vitest-tested), a static page under `pages/convert/` that reuses the real `encodeShare`, and a standalone Vite build emitting committed output to `docs/convert/` served by the existing `/docs` Pages source.

**Tech Stack:** TypeScript, Vite 5.4 (standalone config), `lz-string` (already a dep) via `src/lib/share.ts`, vitest, vanilla DOM for the page.

---

## File map

**Part A**
- `docs/store/listing.md` *(modified)* — remove mandatory-disclosure framing; flip 3 data categories to No; fix checklist.

**Part B**
- `src/lib/modheader.ts` *(new)* — pure `convertModHeader(raw): ConvertResult`.
- `src/lib/modheader.test.ts` *(new)* — mapping + round-trip tests.
- `pages/convert/index.html` *(new)* — page markup.
- `pages/convert/main.ts` *(new)* — DOM glue: parse → convert → encode → render.
- `pages/convert/style.css` *(new)* — minimal dark styling.
- `vite.pages.config.ts` *(new)* — build root `pages/convert` → `docs/convert`.
- `package.json` *(modified)* — add `build:pages` script + `vite` devDependency.
- `docs/convert/*` *(generated + committed)* — build output.

Prereq ordering: Part A is independent. Part B tasks are ordered B1 (core + tests) → B2 (page) → B3 (build config + output). Do B1 first — everything else depends on `convertModHeader`.

---

# Part A — Store docs correction

## Task A1 — Remove the mandatory-disclosure warning banner

File: `docs/store/listing.md`. Delete the entire top blockquote banner. Find and remove this exact block (including the trailing `---` separator that follows it and its surrounding blank lines):

Remove from:
```markdown
> ⚠️ **Data-usage disclosure is mandatory here — "does not collect" is not an
```
through the end of that blockquote at:
```markdown
> the per-category answers.
```

Leave the `# Store listing tab` heading and everything after it intact. (The `---` that separated the banner from `# Store listing tab` stays as the section divider.)

**Verify:**
```bash
grep -c "disclosure is mandatory" docs/store/listing.md
```
Expected output: `0`

## Task A2 — Flip the three data-usage categories to No

File: `docs/store/listing.md`. In the **What user data do you plan to collect?** table, replace the three `**Yes**` rows.

Replace:
```markdown
| **Authentication information** | **Yes** | The live log can *observe* `Authorization` / `Cookie` request headers for a request matching an enabled rule. On-device only (in-memory session storage), never transmitted, sold, or transferred. |
```
with:
```markdown
| Authentication information | **No** | Not collected. Request headers a matched rule observes are held only in in-memory session storage, never written to disk, and never transmitted, sold, or transferred off-device. |
```

Replace:
```markdown
| **Web history** | **Yes** | Matched request URLs surface in the live log, and the toolbar badge reads the active tab's URL (via host access) to count how many profiles apply. On-device only, never transmitted. |
```
with:
```markdown
| Web history | **No** | Not collected. Matched URLs surface in the in-memory live log only and the active-tab URL is read transiently for the badge count; nothing is stored to disk or transmitted. |
```

Replace:
```markdown
| **User activity** | **Yes** | The live log observes matched requests via `webRequest` (network monitoring) and records **all** of their request headers — "the content of the HTTP requests" per FAQ Q2. On-device only (in-memory session storage), never transmitted. |
```
with:
```markdown
| User activity | **No** | Not collected. The live log's observation of matched requests lives only in in-memory session storage, is cleared when the browser closes, and is never transmitted. |
```

**Verify:**
```bash
grep -c "| \*\*Yes\*\* |" docs/store/listing.md
```
Expected output: `0`

## Task A3 — Remove the "why these three are declared" explainer

File: `docs/store/listing.md`. Delete the blockquote immediately below the table that begins:
```markdown
> **Why these three are declared (not optional):** FAQ Q3 and Q14 require
```
and ends:
```markdown
> never page or response content.
```
Delete the whole blockquote and its surrounding blank line.

**Verify:**
```bash
grep -c "Why these three are declared" docs/store/listing.md
```
Expected output: `0`

## Task A4 — Fix the submission-checklist data-usage line

File: `docs/store/listing.md`. In the `## Submission checklist` section, replace:
```markdown
- [ ] Data-usage declared: Authentication information + Web history + User activity = Yes; three Limited-Use certifications checked (disclosure is mandatory — FAQ Q3/Q14 — so "does not collect" is not valid here)
```
with:
```markdown
- [ ] Data usage: no data categories declared (all "No"); three Limited-Use certifications checked
```

**Verify:**
```bash
grep -c "no data categories declared" docs/store/listing.md
```
Expected output: `1`

## Task A5 — Commit Part A

```bash
git add docs/store/listing.md
git commit -m "docs: correct store data-usage to no-categories-declared (as approved)"
```

---

# Part B — ModHeader converter

## Task B1 — `convertModHeader` core + tests

### B1.1 — Write the failing test

Create `src/lib/modheader.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { convertModHeader } from "./modheader";
import { encodeShare, decodeShare } from "./share";

describe("convertModHeader", () => {
  it("throws on input without a profiles array", () => {
    expect(() => convertModHeader({})).toThrow("Not a ModHeader export: missing profiles array");
    expect(() => convertModHeader(null)).toThrow("Not a ModHeader export: missing profiles array");
  });

  it("maps a single enabled urlFilter to a regex matcher", () => {
    const { config } = convertModHeader({
      version: 2,
      profiles: [{ title: "A", urlFilters: [{ enabled: true, urlRegex: ".*foo.*" }], headers: [] }],
    });
    expect(config.profiles[0].matcher).toEqual({ mode: "regex", value: ".*foo.*" });
  });

  it("ORs multiple enabled urlFilters into one alternation regex", () => {
    const { config } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: "a" }, { enabled: true, urlRegex: "b" }],
        headers: [],
      }],
    });
    expect(config.profiles[0].matcher).toEqual({ mode: "regex", value: "(a)|(b)" });
  });

  it("ignores disabled urlFilters when building the matcher", () => {
    const { config } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: false, urlRegex: "off" }, { enabled: true, urlRegex: "on" }],
        headers: [],
      }],
    });
    expect(config.profiles[0].matcher).toEqual({ mode: "regex", value: "on" });
  });

  it("falls back to .* and warns when no active filter", () => {
    const { config, warnings } = convertModHeader({ profiles: [{ title: "A", headers: [] }] });
    expect(config.profiles[0].matcher).toEqual({ mode: "regex", value: ".*" });
    expect(warnings).toContainEqual('Profile "A": no active URL filter → matches all URLs (imported disabled).');
  });

  it("names an untitled profile by position", () => {
    const { config } = convertModHeader({ profiles: [{ headers: [] }] });
    expect(config.profiles[0].name).toBe("Imported profile 1");
  });

  it("always imports profiles disabled", () => {
    const { config } = convertModHeader({
      profiles: [{ title: "A", urlFilters: [{ enabled: true, urlRegex: "x" }], headers: [] }],
    });
    expect(config.profiles[0].enabled).toBe(false);
  });

  it("maps headers to Set rules, preserving enabled and skipping empty names", () => {
    const { config } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: "x" }],
        headers: [
          { name: "X-One", value: "1", enabled: true },
          { name: "X-Two", value: "2", enabled: false },
          { name: "", value: "skip" },
        ],
      }],
    });
    expect(config.profiles[0].rules).toEqual([
      { id: "", enabled: true, op: "set", name: "X-One", value: "1" },
      { id: "", enabled: false, op: "set", name: "X-Two", value: "2" },
    ]);
  });

  it("warns when a header uses append mode (becomes Set)", () => {
    const { warnings } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: "x" }],
        headers: [{ name: "X-App", value: "v", enabled: true, appendMode: true }],
      }],
    });
    expect(warnings).toContainEqual('Profile "A" header "X-App": append became overwrite (Set).');
  });

  it("warns on dropped excludeUrlFilters, methods, and respHeaders", () => {
    const { warnings } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: "x", methods: ["GET"] }],
        excludeUrlFilters: [{ enabled: true, urlRegex: "no" }],
        respHeaders: [{ name: "X-Resp", value: "r", enabled: true }],
        headers: [],
      }],
    });
    expect(warnings).toContainEqual('Profile "A": 1 exclude filter(s) dropped (not supported) — headers may apply to URLs you excluded.');
    expect(warnings).toContainEqual('Profile "A": HTTP-method filter dropped (not supported) — rule applies to all methods.');
    expect(warnings).toContainEqual('Profile "A": 1 response-header rule(s) dropped — Header Handler only edits request headers.');
  });

  it("produces a global share string that round-trips through decodeShare", () => {
    const { config } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: ".*foo.*" }],
        headers: [{ name: "X-One", value: "1", enabled: true }],
      }],
    });
    const str = encodeShare({ kind: "g", config });
    expect(str.startsWith("HH1g")).toBe(true);
    const decoded = decodeShare(str);
    expect(decoded.kind).toBe("g");
    if (decoded.kind === "g") {
      expect(decoded.profiles).toHaveLength(1);
      expect(decoded.profiles[0].name).toBe("A");
      expect(decoded.profiles[0].enabled).toBe(false);
      expect(decoded.profiles[0].matcher).toEqual({ mode: "regex", value: ".*foo.*" });
      expect(decoded.profiles[0].rules[0].name).toBe("X-One");
    }
  });
});
```

Run — confirm it fails because the module does not exist yet:
```bash
npm test -- src/lib/modheader.test.ts
```
Expected: failure resolving `./modheader` (module not found).

### B1.2 — Implement `convertModHeader`

Create `src/lib/modheader.ts`:

```ts
import type { Config, Profile, HeaderRule, Matcher } from "../types";

export interface ConvertResult {
  config: Config;
  warnings: string[];
}

interface MhHeader {
  name?: unknown;
  value?: unknown;
  enabled?: unknown;
  appendMode?: unknown;
}

interface MhUrlFilter {
  enabled?: unknown;
  urlRegex?: unknown;
  methods?: unknown;
}

interface MhProfile {
  title?: unknown;
  headers?: unknown;
  urlFilters?: unknown;
  excludeUrlFilters?: unknown;
  respHeaders?: unknown;
}

// Convert a parsed ModHeader v2 export into a Header Handler Config plus a list
// of human-readable warnings for every lossy mapping. Never throws on lossy
// content — only on input that is not a ModHeader export at all. Profiles are
// always imported disabled: ModHeader carries no per-profile on/off state,
// no-filter profiles become match-all, and dropped excludes broaden scope, so
// nothing should fire until the user reviews it.
export function convertModHeader(raw: unknown): ConvertResult {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { profiles?: unknown }).profiles)) {
    throw new Error("Not a ModHeader export: missing profiles array");
  }
  const mhProfiles = (raw as { profiles: unknown[] }).profiles;
  const warnings: string[] = [];

  const profiles: Profile[] = mhProfiles.map((rawProfile, i) => {
    const p = (rawProfile ?? {}) as MhProfile;
    const name = typeof p.title === "string" && p.title.trim() !== "" ? p.title : `Imported profile ${i + 1}`;

    // Matcher: OR the enabled urlFilters; fall back to match-all.
    const urlFilters: MhUrlFilter[] = Array.isArray(p.urlFilters) ? (p.urlFilters as MhUrlFilter[]) : [];
    const active = urlFilters.filter(
      (f) => f && f.enabled !== false && typeof f.urlRegex === "string" && f.urlRegex.trim() !== "",
    );
    let matcher: Matcher;
    if (active.length === 0) {
      matcher = { mode: "regex", value: ".*" };
      warnings.push(`Profile "${name}": no active URL filter → matches all URLs (imported disabled).`);
    } else if (active.length === 1) {
      matcher = { mode: "regex", value: active[0].urlRegex as string };
    } else {
      matcher = { mode: "regex", value: active.map((f) => `(${f.urlRegex as string})`).join("|") };
    }
    if (active.some((f) => Array.isArray(f.methods) && f.methods.length > 0)) {
      warnings.push(`Profile "${name}": HTTP-method filter dropped (not supported) — rule applies to all methods.`);
    }

    // Unsupported scope / response-header features → warn and drop.
    const excludes = Array.isArray(p.excludeUrlFilters) ? p.excludeUrlFilters : [];
    if (excludes.length > 0) {
      warnings.push(
        `Profile "${name}": ${excludes.length} exclude filter(s) dropped (not supported) — headers may apply to URLs you excluded.`,
      );
    }
    const respHeaders = Array.isArray(p.respHeaders) ? p.respHeaders : [];
    if (respHeaders.length > 0) {
      warnings.push(
        `Profile "${name}": ${respHeaders.length} response-header rule(s) dropped — Header Handler only edits request headers.`,
      );
    }

    // Header rules: each ModHeader request header becomes a Set rule.
    const mhHeaders: MhHeader[] = Array.isArray(p.headers) ? (p.headers as MhHeader[]) : [];
    const rules: HeaderRule[] = [];
    for (const h of mhHeaders) {
      const hname = typeof h?.name === "string" ? h.name : "";
      if (hname.trim() === "") continue;
      if (h.appendMode === true) {
        warnings.push(`Profile "${name}" header "${hname}": append became overwrite (Set).`);
      }
      rules.push({
        id: "",
        enabled: h.enabled !== false,
        op: "set",
        name: hname,
        value: String(h.value ?? ""),
      });
    }

    return { id: "", name, enabled: false, matcher, rules };
  });

  return { config: { version: 1, masterEnabled: true, profiles }, warnings };
}
```

Run — confirm the suite passes:
```bash
npm test -- src/lib/modheader.test.ts
```
Expected: all tests pass.

### B1.3 — Commit

```bash
git add src/lib/modheader.ts src/lib/modheader.test.ts
git commit -m "feat: ModHeader export → Header Handler config converter"
```

## Task B2 — The converter page

### B2.1 — Page markup

Create `pages/convert/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Header Handler — ModHeader Converter</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <main class="wrap">
    <h1>ModHeader → Header Handler</h1>
    <p class="lead">
      Paste a ModHeader export below to get a Header Handler share string. It runs
      entirely in your browser — nothing is uploaded. Then open Header Handler's
      options page, click <strong>Import</strong>, and paste the result.
    </p>

    <label class="field-label" for="input">ModHeader JSON export</label>
    <textarea id="input" class="io" placeholder='{"version":2,"profiles":[…]}'></textarea>

    <div class="actions">
      <button id="convert" type="button" class="btn">Convert</button>
    </div>

    <p id="error" class="error" hidden></p>

    <section id="result" hidden>
      <p id="summary" class="summary"></p>

      <label class="field-label" for="output">Header Handler share string</label>
      <textarea id="output" class="io" readonly></textarea>
      <div class="actions">
        <button id="copy" type="button" class="btn">Copy</button>
        <span id="copied" class="copied" hidden>Copied</span>
      </div>

      <ul id="warnings" class="warnings"></ul>
    </section>
  </main>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

### B2.2 — DOM glue

Create `pages/convert/main.ts`:

```ts
import { convertModHeader } from "../../src/lib/modheader";
import { encodeShare } from "../../src/lib/share";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>("input");
const output = $<HTMLTextAreaElement>("output");
const errorEl = $<HTMLParagraphElement>("error");
const resultEl = $<HTMLElement>("result");
const summaryEl = $<HTMLParagraphElement>("summary");
const warningsEl = $<HTMLUListElement>("warnings");
const copiedEl = $<HTMLSpanElement>("copied");

function showError(message: string) {
  errorEl.textContent = message;
  errorEl.hidden = false;
  resultEl.hidden = true;
}

function convert() {
  errorEl.hidden = true;
  copiedEl.hidden = true;

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.value);
  } catch (e) {
    showError(`Not valid JSON: ${(e as Error).message}`);
    return;
  }

  let result;
  try {
    result = convertModHeader(parsed);
  } catch (e) {
    showError((e as Error).message);
    return;
  }

  const { config, warnings } = result;
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
}

$<HTMLButtonElement>("convert").addEventListener("click", convert);
$<HTMLButtonElement>("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(output.value);
  copiedEl.hidden = false;
});
```

### B2.3 — Styling

Create `pages/convert/style.css`:

```css
:root {
  color-scheme: dark;
  --bg: #0b0b0c;
  --surface: #141417;
  --border: #2a2a2e;
  --text: #e7e7e9;
  --muted: #8a8a90;
  --accent: #6ea8fe;
  --danger: #f2777a;
  --warn: #e6c04d;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); line-height: 1.6; }
.wrap { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; }
h1 { font-size: 26px; margin: 0 0 8px; }
.lead { color: var(--muted); font-size: 15px; margin: 0 0 28px; }
.field-label { display: block; font-size: 13px; color: var(--muted); margin: 20px 0 6px; }
.io {
  width: 100%; min-height: 160px; resize: vertical;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 8px;
  padding: 12px 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px; line-height: 1.5;
}
.io[readonly] { color: var(--accent); word-break: break-all; }
.actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.btn {
  background: var(--accent); color: #0b0b0c; border: 0; border-radius: 8px;
  padding: 9px 18px; font-size: 14px; font-weight: 600; cursor: pointer;
}
.btn:hover { filter: brightness(1.08); }
.copied { color: var(--muted); font-size: 13px; }
.error { color: var(--danger); font-size: 14px; margin: 16px 0 0; }
.summary { font-size: 14px; margin: 0 0 4px; }
.warnings { list-style: none; padding: 0; margin: 20px 0 0; }
.warnings li {
  color: var(--warn); font-size: 13px; padding: 6px 0;
  border-top: 1px solid var(--border);
}
```

### B2.4 — Commit

```bash
git add pages/convert/index.html pages/convert/main.ts pages/convert/style.css
git commit -m "feat: ModHeader converter GitHub Pages page"
```

## Task B3 — Build config, script, and committed output

### B3.1 — Vite config

Create `vite.pages.config.ts`:

```ts
import { defineConfig } from "vite";

// Standalone build for the GitHub Pages converter, separate from the wxt
// extension build. Emits into docs/convert/ so the existing /docs Pages source
// serves it alongside docs/privacy.html. Relative base so asset URLs work under
// the /header-handler/ project-site path. See docs/adr/0004.
export default defineConfig({
  root: "pages/convert",
  base: "./",
  build: {
    outDir: "../../docs/convert",
    emptyOutDir: true,
  },
});
```

### B3.2 — Add the script and dev dependency

Edit `package.json`. In `"scripts"`, add after `"zip"`:
```json
    "build:pages": "vite build --config vite.pages.config.ts"
```
(remember the trailing comma on the preceding `"zip"` line).

In `"devDependencies"`, add:
```json
    "vite": "^5.4.0",
```
(keep entries alphabetical / valid JSON — `vite` sorts after `jsdom`, before `vitest`).

### B3.3 — Build and verify output

```bash
npm run build:pages
```
Expected: Vite prints `✓ built in …` and writes `docs/convert/index.html` plus a hashed JS asset under `docs/convert/assets/`.

Confirm the share encoder was bundled (proves `share.ts` + `lz-string` were reused, not reimplemented):
```bash
test -f docs/convert/index.html && grep -rl "HH1g\|HH" docs/convert/assets >/dev/null && echo "built ok"
```
Expected output: `built ok`
(If the `grep` misses due to minification of the `"HH"` literal, fall back to just confirming `docs/convert/index.html` and a non-empty `docs/convert/assets/` exist.)

### B3.4 — Manual smoke test

```bash
python3 -m http.server 8000 --directory docs
```
Open `http://localhost:8000/convert/`, paste a small ModHeader export
(e.g. `{"profiles":[{"title":"A","urlFilters":[{"enabled":true,"urlRegex":".*foo.*"}],"headers":[{"name":"X-One","value":"1","enabled":true}]}]}`),
click Convert, and confirm: an `HH1g…` string appears, the summary says 1 profile / 1 rule / imported disabled, and Copy works. Stop the server (Ctrl-C) when done.

### B3.5 — Commit build config and output together

```bash
git add package.json package-lock.json vite.pages.config.ts docs/convert
git commit -m "build: standalone Vite build emitting the converter to docs/convert"
```
(Run `npm install` first if adding the `vite` devDependency changed `package-lock.json`.)

## Task B4 — Full test + typecheck gate

```bash
npm test
```
Expected: the whole suite passes, including `src/lib/modheader.test.ts`.

Optional link from the README (out of scope unless desired): a line pointing users to `https://curtyo18.github.io/header-handler/convert/`.

---

## Self-review

- **Spec coverage:** Part A tasks A1–A4 cover the banner, table, explainer, and checklist edits in the spec; A5 commits. Part B: B1 = `convertModHeader` + every mapping/warning rule and the round-trip; B2 = page (input, convert, output, summary, warnings, copy, client-side); B3 = Vite build to committed `docs/convert` reusing `encodeShare`; B4 = test gate. `privacy.html` is intentionally untouched (spec Out of scope). No spec section is unimplemented.
- **Type consistency:** `ConvertResult { config: Config; warnings: string[] }`, `convertModHeader(raw: unknown): ConvertResult`, `encodeShare({ kind: "g", config })`, and `Config`/`Profile`/`HeaderRule`/`Matcher` shapes match `src/types.ts` and `src/lib/share.ts` across the mapper, tests, and page glue. Rule objects use `{ id, enabled, op: "set", name, value }` everywhere; profile objects use `{ id, name, enabled: false, matcher, rules }` everywhere.
- **Placeholder scan:** no `TBD`/`TODO`/"similar to"/partial snippets; every task has exact paths, full code, and exact commands with expected output.
- **Proprietary data:** tests use synthetic ModHeader objects only; the request's real export is never written to the repo.
