# All-URLs Default Matcher + Header-Name Field — Implementation Plan

**Goal:** A newly created profile matches every URL and works with zero configuration, with a proportionate in-editor nudge to scope it; and the header-name field grows with the row instead of truncating long names.

**Architecture:** All-URLs is an *encoding*, not a new `MatchMode` — it is the existing Custom regex mode with the exact value `.*` (the shape `src/lib/modheader.ts:71` already emits), recognized by `isAllUrls()` and compiled to the cheap `{ urlFilter: "*" }` DNR condition. The editor surfaces it as a UI-only sentinel option in the mode select. A single pure predicate, `sendsHeadersEverywhere()`, drives whether the nudge under the matcher is calm or escalated.

**Tech Stack:** TypeScript, Preact + `preact/hooks`, WXT, `chrome.declarativeNetRequest`, Vitest + `@testing-library/preact` (jsdom).

**Spec:** `specs/2026-08-29-all-urls-default-and-name-field-design.md`
**ADR:** `docs/adr/0008-all-urls-as-regex-dot-star.md`

## File map

| File | Change |
|---|---|
| `src/lib/matcher.ts` | add `ALL_URLS_MATCHER`, `isAllUrls`, all-URLs branch in `matcherToDnrCondition`, `sendsHeadersEverywhere` |
| `src/lib/matcher.test.ts` | tests for all four additions |
| `src/lib/compile.test.ts` | regression: an all-URLs profile compiles a live rule |
| `src/lib/share.test.ts` | regression: an all-URLs profile survives encode → decode |
| `entrypoints/options/MatcherControl.tsx` | All URLs option, hide value input, calm/escalated nudge |
| `entrypoints/options/main.tsx` | `newProfile()` seeds all-URLs; pass `escalated` |
| `entrypoints/options/main.test.tsx` | new profile reads "All URLs" and shows the calm nudge |
| `entrypoints/options/style.css` | `.helper-warn`; `.header-name-input` + `.col-name` flex sizing |
| `README.md` | two stale sentences |
| `CONTEXT.md` | glossary entry (**already applied** — do not redo) |
| `docs/adr/0008-all-urls-as-regex-dot-star.md` | ADR (**already written** — do not redo) |

Branch: `feat/all-urls-default-and-name-field`.
Commit 1 = Tasks 1–9. Commit 2 = Task 10. One PR into `main`.

---

## Task 1 — `isAllUrls` + `ALL_URLS_MATCHER`

**1a. Write the failing test.** Append to `src/lib/matcher.test.ts`:

```ts
describe("all-URLs matcher", () => {
  it("recognizes exactly the regex .* shape", () => {
    expect(isAllUrls(ALL_URLS_MATCHER)).toBe(true);
    expect(isAllUrls({ mode: "regex", value: ".*" })).toBe(true);
    expect(isAllUrls({ mode: "regex", value: ".+" })).toBe(false);
    expect(isAllUrls({ mode: "regex", value: " .* " })).toBe(false);
    expect(isAllUrls({ mode: "contains", value: ".*" })).toBe(false);
    expect(isAllUrls({ mode: "contains", value: "" })).toBe(false);
  });

  it("is the shape the ModHeader converter already emits for no-filter profiles", () => {
    expect(ALL_URLS_MATCHER).toEqual({ mode: "regex", value: ".*" });
  });
});
```

Add `ALL_URLS_MATCHER` and `isAllUrls` to the existing import from `./matcher` at the top of the file.

**1b. Run it — expect failure.** `npx vitest run src/lib/matcher.test.ts`
Expected: `SyntaxError` / `does not provide an export named 'isAllUrls'`.

**1c. Implement.** In `src/lib/matcher.ts`, directly below the `MATCH_MODES` declaration:

```ts
// All-URLs is an encoding, not a seventh mode: it is the Custom regex mode with
// the exact value ".*" — the same shape the ModHeader converter has emitted for
// a no-filter profile since it shipped (modheader.ts). A new MatchMode would be
// rejected by isMatchMode on an older client reading the same synced config
// (ADR-0006) or a pasted share string (ADR-0002), silently matching nothing.
// See ADR-0008.
export const ALL_URLS_MATCHER: Matcher = { mode: "regex", value: ".*" };

export function isAllUrls(m: Matcher): boolean {
  return m.mode === "regex" && m.value === ".*";
}
```

**1d. Run it — expect pass.** `npx vitest run src/lib/matcher.test.ts`

---

## Task 2 — compile all-URLs to `urlFilter: "*"`

**2a. Write the failing test.** Append inside the `describe("all-URLs matcher", …)` block in `src/lib/matcher.test.ts`:

```ts
it("compiles to a plain match-all urlFilter, not an RE2 evaluation", () => {
  expect(matcherToDnrCondition(ALL_URLS_MATCHER)).toEqual({ urlFilter: "*" });
});

it("still compiles an ordinary regex through regexFilter", () => {
  expect(matcherToDnrCondition({ mode: "regex", value: "^https://x\\.dev/" }))
    .toEqual({ regexFilter: "^https://x\\.dev/" });
});
```

**2b. Run it — expect failure.** `npx vitest run src/lib/matcher.test.ts`
Expected: received `{ regexFilter: '.*' }`, expected `{ urlFilter: '*' }`.

**2c. Implement.** In `matcherToDnrCondition`, insert as the first statement of the function body, before the `switch`:

```ts
  // Every newly created profile is on this matcher, so the default path must be
  // a plain filter match rather than an RE2 evaluation on every request. DNR
  // treats a urlFilter of "*" as match-all. (ADR-0008)
  if (isAllUrls(m)) return { urlFilter: "*" };
```

**2d. Run it — expect pass.** `npx vitest run src/lib/matcher.test.ts`

> Do **not** touch `evaluateMatcher`: `new RegExp(".*").test(url)` is already unconditionally true, so the live log and badge agree with the compiled rule without a special case.

---

## Task 3 — `sendsHeadersEverywhere` predicate

**3a. Write the failing test.** Append to `src/lib/matcher.test.ts`:

```ts
function profile(over: Partial<Profile> = {}): Profile {
  return {
    id: "p1",
    name: "P",
    enabled: true,
    matcher: { ...ALL_URLS_MATCHER },
    rules: [{ id: "r1", enabled: true, op: "set", name: "X-A", value: "1" }],
    ...over,
  };
}

describe("sendsHeadersEverywhere", () => {
  it("is true for an enabled Set rule inheriting an all-URLs profile matcher", () => {
    expect(sendsHeadersEverywhere(profile())).toBe(true);
  });

  it("is true for an Append rule too", () => {
    expect(sendsHeadersEverywhere(profile({
      rules: [{ id: "r1", enabled: true, op: "append", name: "Accept", value: "x" }],
    }))).toBe(true);
  });

  it("is false when the profile is disabled — nothing is being sent", () => {
    expect(sendsHeadersEverywhere(profile({ enabled: false }))).toBe(false);
  });

  it("is false with no rules at all", () => {
    expect(sendsHeadersEverywhere(profile({ rules: [] }))).toBe(false);
  });

  it("mirrors compileRules: a disabled or blank-name rule emits nothing", () => {
    expect(sendsHeadersEverywhere(profile({
      rules: [{ id: "r1", enabled: false, op: "set", name: "X-A", value: "1" }],
    }))).toBe(false);
    expect(sendsHeadersEverywhere(profile({
      rules: [{ id: "r1", enabled: true, op: "set", name: "   ", value: "1" }],
    }))).toBe(false);
  });

  it("is false for Remove-only rules — a Remove sends no data anywhere", () => {
    expect(sendsHeadersEverywhere(profile({
      rules: [{ id: "r1", enabled: true, op: "remove", name: "X-A" }],
    }))).toBe(false);
  });

  it("is false when every rule overrides to a narrow matcher", () => {
    expect(sendsHeadersEverywhere(profile({
      rules: [{
        id: "r1", enabled: true, op: "set", name: "X-A", value: "1",
        matcher: { mode: "domain", value: "example.com" },
      }],
    }))).toBe(false);
  });

  it("is true when a rule's own override is itself all-URLs", () => {
    expect(sendsHeadersEverywhere(profile({
      matcher: { mode: "domain", value: "example.com" },
      rules: [{
        id: "r1", enabled: true, op: "set", name: "X-A", value: "1",
        matcher: { ...ALL_URLS_MATCHER },
      }],
    }))).toBe(true);
  });
});
```

Add `sendsHeadersEverywhere` to the `./matcher` import and `import type { Profile } from "../types";` at the top of the test file.

**3b. Run it — expect failure.** `npx vitest run src/lib/matcher.test.ts`
Expected: `does not provide an export named 'sendsHeadersEverywhere'`.

**3c. Implement.** Append to `src/lib/matcher.ts`, and extend the type import on line 1 to `import type { Matcher, MatchMode, Profile } from "../types";`:

```ts
// Drives the escalated form of the all-URLs nudge in the options editor. The
// conditions mirror compileRules exactly — a disabled or blank-name rule emits
// nothing, and a Remove sends no data anywhere — so the warning fires only when
// headers really do reach every URL. A rule carrying its own override doesn't
// use the profile matcher, so the effective matcher is what's tested.
// Deliberately ignores the master switch: that's a temporary global pause, and
// the profile is still misconfigured underneath it.
export function sendsHeadersEverywhere(p: Profile): boolean {
  if (!p.enabled) return false;
  return p.rules.some(
    (r) =>
      r.enabled &&
      r.op !== "remove" &&
      r.name.trim() !== "" &&
      isAllUrls(r.matcher ?? p.matcher),
  );
}
```

**3d. Run it — expect pass.** `npx vitest run src/lib/matcher.test.ts`

---

## Task 4 — compile regression test (the #38 bug, pinned)

**4a. Write the test.** Append to `src/lib/compile.test.ts`, matching that file's existing config-builder style:

```ts
it("compiles a live rule for a profile on the all-URLs matcher (#38)", () => {
  const rules = compileRules({
    version: 1,
    masterEnabled: true,
    profiles: [{
      id: "p1", name: "New profile", enabled: true,
      matcher: { mode: "regex", value: ".*" },
      rules: [{ id: "r1", enabled: true, op: "set", name: "X-A", value: "1" }],
    }],
  });
  expect(rules).toHaveLength(1);
  expect(rules[0].condition.urlFilter).toBe("*");
  expect(rules[0].condition.regexFilter).toBeUndefined();
});

it("still skips a profile whose matcher value is empty — no silent activation on update", () => {
  const rules = compileRules({
    version: 1,
    masterEnabled: true,
    profiles: [{
      id: "p1", name: "Old profile", enabled: true,
      matcher: { mode: "contains", value: "" },
      rules: [{ id: "r1", enabled: true, op: "set", name: "X-A", value: "1" }],
    }],
  });
  expect(rules).toHaveLength(0);
});
```

**4b. Run.** `npx vitest run src/lib/compile.test.ts` — both pass (Task 2 already landed the behaviour; the second test pins the deliberate no-migration decision).

---

## Task 5 — share round-trip regression test

This pins the entire safety argument for ADR-0008: the all-URLs shape must survive `decodeShare`'s validation on any client.

**5a. Write the test.** Append to `src/lib/share.test.ts`:

```ts
it("round-trips an all-URLs profile unchanged (ADR-0008 — no new MatchMode on the wire)", () => {
  const profile: Profile = {
    id: "p1", name: "Everywhere", enabled: true,
    matcher: { mode: "regex", value: ".*" },
    rules: [{ id: "r1", enabled: true, op: "set", name: "X-A", value: "1" }],
  };
  const decoded = decodeShare(encodeShare({ kind: "p", profile }));
  expect(decoded.kind).toBe("p");
  if (decoded.kind !== "p") throw new Error("unreachable");
  expect(decoded.profile.matcher).toEqual({ mode: "regex", value: ".*" });
  expect(isAllUrls(decoded.profile.matcher)).toBe(true);
});
```

Add `import { isAllUrls } from "./matcher";` and, if not already imported there, `import type { Profile } from "../types";`.

**5b. Run.** `npx vitest run src/lib/share.test.ts` — passes.

---

## Task 6 — All URLs in `MatcherControl`

**6a. Implement.** In `entrypoints/options/MatcherControl.tsx`:

Extend the import on line 2 and add the matcher import:

```tsx
import type { Matcher, MatchMode } from "../../src/types";
import { ALL_URLS_MATCHER, isAllUrls } from "../../src/lib/matcher";
```

Add below `MODE_OPTIONS`:

```tsx
// A UI-only sentinel. All URLs is not a MatchMode — it's the regex ".*" shape
// (ADR-0008) — so the select's value is isAllUrls(m) ? ALL_URLS_VALUE : m.mode
// rather than m.mode alone. Consequence: picking Custom regex and typing ".*"
// flips the control to All URLs. That label is accurate, and UI-only intent
// state would be right until the page reloads and wrong afterwards.
const ALL_URLS_VALUE = "all";

const ALL_URLS_CALM =
  "Applies to every URL. Set a URL matcher to limit which sites this profile touches.";
const ALL_URLS_ESCALATED =
  "⚠ These headers are sent to every URL, including sites you don't control. Set a URL matcher to scope this profile.";
```

Add the `escalated` prop to the signature:

```tsx
export function MatcherControl({
  matcher,
  onChange,
  compact,
  escalated,
}: {
  matcher: Matcher;
  onChange: (next: Matcher) => void;
  compact?: boolean;
  escalated?: boolean;
}) {
  const allUrls = isAllUrls(matcher);
  const jsError = regexError(matcher.mode, matcher.value);
  const re2Error = useRe2Error(matcher.mode, matcher.value, jsError !== null);
  const error = jsError ?? re2Error;

  function selectMode(next: string) {
    if (next === ALL_URLS_VALUE) {
      onChange({ ...ALL_URLS_MATCHER });
      return;
    }
    // Leaving All URLs clears the value: carrying ".*" into e.g. Contains would
    // look scoped but match only URLs literally containing ".*".
    onChange({ mode: next as MatchMode, value: allUrls ? "" : matcher.value });
  }
```

Replace the JSX body with:

```tsx
  return (
    <div>
      <div class="matcher-row">
        <select
          class={`select ${compact ? "select-sm" : ""} matcher-mode`}
          value={allUrls ? ALL_URLS_VALUE : matcher.mode}
          onChange={(e) => selectMode((e.target as HTMLSelectElement).value)}
        >
          <option value={ALL_URLS_VALUE} key={ALL_URLS_VALUE}>
            All URLs
          </option>
          {MODE_OPTIONS.map((o) => (
            <option value={o.mode} key={o.mode}>
              {o.label}
            </option>
          ))}
        </select>
        {!allUrls && (
          <input
            class={`input input-mono matcher-value ${error ? "input-danger" : ""}`}
            type="text"
            value={matcher.value}
            onInput={(e) => onChange({ ...matcher, value: (e.target as HTMLInputElement).value })}
            placeholder="value to match"
          />
        )}
      </div>
      {allUrls ? (
        <div class={`helper ${escalated ? "helper-warn" : ""}`} role={escalated ? "status" : undefined}>
          {escalated ? ALL_URLS_ESCALATED : ALL_URLS_CALM}
        </div>
      ) : error ? (
        <div class="helper helper-danger">⚠ Invalid regular expression: {error}</div>
      ) : (
        <div class="helper helper-mono">{HINTS[matcher.mode]}</div>
      )}
    </div>
  );
}
```

**6b. Run.** `npx vitest run entrypoints/options` — the existing `HeaderRow` and options tests must still pass. If a test asserts on the matcher value input being present for a `contains` matcher, it is unaffected: the input only hides for the all-URLs shape.

---

## Task 7 — `newProfile()` default + wiring `escalated`

**7a. Write the failing test.** Append to `entrypoints/options/main.test.tsx`:

```tsx
describe("New profile default matcher (#38)", () => {
  it("creates a profile scoped to All URLs and nudges the user to scope it", async () => {
    render(<App />);
    await screen.findByDisplayValue("Auth");

    fireEvent.click(screen.getByText("＋ New profile"));

    const modeSelect = await screen.findByDisplayValue("All URLs");
    expect(modeSelect).toBeTruthy();
    expect(screen.getByText(/Applies to every URL/i)).toBeTruthy();
    // No rules yet, so the calm state — not the escalated warning.
    expect(screen.queryByText(/sent to every URL/i)).toBeNull();
  });
});
```

> `setValue` in that file's mock rejects by design (it exists to prove issue #5). The new profile is still applied to local state by `update()` before the write settles, so the assertions above hold; do not change the shared mock.

**7b. Run it — expect failure.** `npx vitest run entrypoints/options/main.test.tsx`
Expected: `Unable to find an element with the display value: All URLs`.

**7c. Implement.** In `entrypoints/options/main.tsx`:

Add to the imports:

```tsx
import { ALL_URLS_MATCHER, sendsHeadersEverywhere } from "../../src/lib/matcher";
```

Replace `newProfile()` (line 26–28):

```tsx
// A new profile matches every URL so it works with zero configuration — an empty
// matcher value compiles to nothing, which made a fresh install look broken (#38).
// The nudge under the matcher control is the counterweight. Spread, don't share
// the module-level constant: profile matchers are mutated by the editor.
function newProfile(): Profile {
  return { id: crypto.randomUUID(), name: "New profile", enabled: true, matcher: { ...ALL_URLS_MATCHER }, rules: [] };
}
```

Pass the predicate at the profile matcher control:

```tsx
              <div>
                <label class="label-sm">URL MATCHER</label>
                <MatcherControl
                  matcher={selected.matcher}
                  onChange={(matcher) => updateSelected({ matcher })}
                  escalated={sendsHeadersEverywhere(selected)}
                />
              </div>
```

Leave the compact `MatcherControl` in `HeaderRow.tsx` alone — it gets the All URLs option automatically and shows the calm copy, which is correct for a rule override.

**7d. Run it — expect pass.** `npx vitest run entrypoints/options/main.test.tsx`

---

## Task 8 — `.helper-warn` style

**8a. Implement.** In `entrypoints/options/style.css`, immediately after the existing `.helper-danger` rule:

```css
/* Amber, matching .size-banner — a scope warning, not a hard error like
   .helper-danger (which means "this rule cannot compile"). */
.helper-warn {
  color: #e0b96a;
}
```

> Before writing this, `grep -n "helper-danger\|e0b96a\|--warn" entrypoints/options/style.css`. If a `--warn`-style custom property already exists in the `:root` block, use `var(--warn)` instead of the literal.

**8b. Verify.** `npm test` — full suite green.

---

## Task 9 — README + commit 1

**9a. Edit `README.md`.**

Replace the Matchers sentence (`A matcher decides which requests a profile or rule applies to, using one of six modes: Contains, Exact, Starts with, Ends with, Domain, or Custom regex.`) with:

```markdown
A matcher decides which requests a profile or rule applies to. It's either **All URLs** — the default for a new profile, matching every request — or one of six scoped modes: Contains, Exact, Starts with, Ends with, Domain, or Custom regex. While a profile is on All URLs the editor shows a reminder to scope it, since its headers go to every site you visit.
```

In the Profiles and header rules paragraph, append to the end of the first sentence's paragraph:

```markdown
A newly created profile starts on the All URLs matcher so it works immediately; narrow it to the sites you actually want it on.
```

> The same paragraph's "a Set or Remove operation" is stale (Append shipped in ADR-0007). Out of scope — leave it.

**9b. Full check.**

```bash
npm test && npx wxt prepare && npm run build && npm run build:pages
```
Expected: vitest all-pass, both builds succeed.

**9c. Commit 1.**

```bash
git checkout -b feat/all-urls-default-and-name-field
git add src/lib/matcher.ts src/lib/matcher.test.ts src/lib/compile.test.ts src/lib/share.test.ts \
        entrypoints/options/MatcherControl.tsx entrypoints/options/main.tsx \
        entrypoints/options/main.test.tsx entrypoints/options/style.css \
        README.md CONTEXT.md docs/adr/0008-all-urls-as-regex-dot-star.md \
        specs/2026-08-29-all-urls-default-and-name-field-design.md \
        plans/2026-08-29-all-urls-default-and-name-field-implementation.md
git commit -m "feat(options): default new profiles to all URLs with a scope nudge

A new profile was created with an empty matcher value, which compileRules
skips — add a profile, add a header, nothing happens. New profiles now start
on an all-URLs matcher and the editor carries a nudge to scope them, escalated
to a warning once an enabled Set/Append rule really is sending headers
everywhere.

All-URLs is the existing regex \".*\" shape rather than a seventh MatchMode, so
it stays readable by older clients over sync and share strings (ADR-0008), and
compiles to urlFilter \"*\" instead of an RE2 evaluation on every request.

Existing profiles with an empty matcher are deliberately not migrated.

Closes #38"
```

No AI-attribution trailers.

---

## Task 10 — Header-name field sizing (#37) + commit 2

**10a. Implement.** In `entrypoints/options/style.css`, replace the `.header-name-input` rule (currently at line ~538):

```css
/* Long header names (Access-Control-Allow-Credentials, X-Forwarded-Proto) were
   truncated in a fixed 132px box with no way to widen it (#37). Flex like
   .value-input next to it, with 132px as the floor so narrow widths look
   exactly as before, and a cap so the name can't crowd out the value field. */
.header-name-input {
  flex: 1 1 132px;
  min-width: 132px;
  max-width: 320px;
  height: 28px;
  padding: 0 9px;
  font-size: 11.5px;
}
```

And the matching column heading (line ~481) so it keeps aligning with the row:

```css
.col-name {
  flex: 1 1 132px;
  min-width: 132px;
  max-width: 320px;
}
```

**10b. Verify.** `npm test && npm run build` — green. The change is CSS-only; there is no unit test for it (a jsdom test cannot measure flex layout).

**10c. Commit 2.**

```bash
git add entrypoints/options/style.css
git commit -m "fix(options): let the header name field grow with the row

The header name input was a fixed 132px with flex: none, truncating names like
Access-Control-Allow-Credentials with no way to widen it. Flex it like the
value field next to it, keeping 132px as the floor so narrow layouts are
unchanged, and update .col-name so the column heading still lines up.

Closes #37"
```

---

## Task 11 — Push and open the PR

```bash
git push -u origin feat/all-urls-default-and-name-field
gh pr create --base main --title "All-URLs default matcher and a resizable header-name field" --body "<body>"
```

PR body must state: both issues closed, the ADR-0008 encoding decision and why no new `MatchMode`, the deliberate no-migration of empty matchers, and the `max-width: 320px` judgement call flagged in the spec. No AI-attribution trailers, no session links.

> Merging to `main` triggers `.github/workflows/auto-release.yml`, which cuts a patch release unconditionally. Do not hand-bump `package.json`.

---

## Self-review

- **Spec coverage** — encoding (T1), compiled form (T2), predicate (T3), no-migration (T4), wire safety (T5), select + nudge + mode switching + compact override (T6), default + wiring (T7), warn style (T8), docs (T9), #37 (T10). All spec sections map to a task.
- **Placeholders** — none; every task has exact paths, full code blocks, and exact commands.
- **Type consistency** — `ALL_URLS_MATCHER: Matcher`, `isAllUrls(m: Matcher): boolean`, `sendsHeadersEverywhere(p: Profile): boolean`, `escalated?: boolean`, sentinel `ALL_URLS_VALUE = "all"` — used identically in every task.
