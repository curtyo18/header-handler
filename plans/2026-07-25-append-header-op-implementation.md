# Append Header Operation Implementation Plan

**Goal:** Add a third header operation, `"append"`, that joins a value onto a header's existing value (via DNR's native comma-delimited append) instead of replacing it, threaded through the type, DNR compiler, share-string validator, editor UI, and the ModHeader converter.

**Architecture:** `HeaderOp` grows from a two-value to a three-value union (`"set" | "remove" | "append"`). Every consumer of `op` already branches on it (a ternary in `compile.ts`, an allowlist check in `share.ts`, a `<select>` in `HeaderRow.tsx`, a hardcoded `"set"` in `modheader.ts`) — each gets extended to the third value in place, no new abstractions. DNR's own `HeaderOperation` enum already has three matching values (`"set" | "append" | "remove"`), so `compile.ts`'s mapping becomes a direct pass-through.

**Tech Stack:** TypeScript, Preact, Vitest, `@testing-library/preact`, `chrome.declarativeNetRequest` types (already a devDependency-provided ambient type, no new dependency).

Spec: `specs/2026-07-25-append-header-op-design.md`. ADR: `docs/adr/0007-append-as-third-op-not-checkbox.md`. `CONTEXT.md`'s Append glossary entry is already in place — no task needed for it.

## File map

| File | Responsibility in this change |
| --- | --- |
| `src/types.ts` | `HeaderOp` union gains `"append"`. |
| `src/lib/compile.ts` | DNR rule compilation: emit `operation: rule.op` directly for all three ops; include `value` for `set` and `append`. |
| `src/lib/compile.test.ts` | Assert an `append` rule compiles to `operation: "append"` with `value` present. |
| `src/lib/share.ts` | `validateRule`'s op allowlist admits `"append"`. |
| `src/lib/share.test.ts` | Assert an `append` rule round-trips through encode/decode. |
| `src/lib/modheader.ts` | `appendMode: true` maps to `op: "append"`; targeted warning for Cookie/Set-Cookie/Authorization. |
| `src/lib/modheader.test.ts` | Rewrite the existing appendMode test (no more downgrade-to-Set warning for generic headers); add the targeted-warning case. |
| `entrypoints/options/HeaderRow.tsx` | Third `<option>` in the op select; `ruleHasBlockingError` extends its JSON check to `append`; value field stays enabled for `append`; new help-icon span with `title=` tooltip. |
| `entrypoints/options/HeaderRow.test.tsx` | Extend `ruleHasBlockingError` coverage to `op: "append"`. |
| `entrypoints/options/style.css` | New `.help-icon` rule, sized/colored to match `.btn-icon-sm`/`.helper`. |

No changes to `src/lib/config-codec.ts`, `src/lib/storage.ts`, `src/lib/matcher.ts`, or any `Config.version`/share-format-version constant (per spec: no schema/format bump needed).

---

## Task 1 — `HeaderOp` gains `"append"`

`src/types.ts:8` currently reads:

```ts
export type HeaderOp = "set" | "remove";
```

1. Edit `src/types.ts` line 8 to:

```ts
export type HeaderOp = "set" | "remove" | "append";
```

2. Run the full type-check / test suite to confirm nothing breaks yet (widening a union is backward-compatible):

```
npx vitest run
```

Expected: all existing tests still pass (this is a pure type widening; nothing narrows on it exhaustively yet).

3. Commit:

```
git add src/types.ts
git commit -m "Add append to HeaderOp"
```

---

## Task 2 — `compile.ts` emits DNR's native `append` operation

`src/lib/compile.test.ts` currently has this fixture (lines 5-16) and first test (lines 18-29):

```ts
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
    expect(rules).toHaveLength(2);
    const set = rules.find((r) => r.action.requestHeaders?.[0].header === "x-a")!;
    expect(set.action.requestHeaders![0].operation).toBe("set");
    expect(set.action.requestHeaders![0].value).toBe("1");
    expect(set.condition).toMatchObject({ requestDomains: ["example.com"] });
    const rm = rules.find((r) => r.action.requestHeaders?.[0].header === "cookie")!;
    expect(rm.action.requestHeaders![0].operation).toBe("remove");
    expect(rm.action.requestHeaders![0].value).toBeUndefined();
  });
```

1. Add a fourth rule to the fixture and a new test, in `src/lib/compile.test.ts`. Change the fixture's `rules` array (lines 10-14) to:

```ts
    rules: [
      { id: "r1", enabled: true, op: "set", name: "X-A", value: "1" },
      { id: "r2", enabled: false, op: "set", name: "X-Off", value: "2" },
      { id: "r3", enabled: true, op: "remove", name: "Cookie" },
      { id: "r4", enabled: true, op: "append", name: "X-App", value: "3" },
    ],
```

Update the first test's `toHaveLength(2)` (line 21) to `toHaveLength(3)` since there's now a third enabled rule. Then add a new test right after the existing `"emits one rule..."` test (after its closing `});` at line 29):

```ts
  it("compiles an append rule to DNR's native append operation with its value", () => {
    const rules = compileRules(cfg);
    const append = rules.find((r) => r.action.requestHeaders?.[0].header === "x-app")!;
    expect(append.action.requestHeaders![0].operation).toBe("append");
    expect(append.action.requestHeaders![0].value).toBe("3");
  });
```

2. Run just this file — expect a failure, since `compile.ts` still hardcodes `rule.op === "set" ? "set" : "remove"`, so the append rule compiles to `operation: "remove"` with no value:

```
npx vitest run src/lib/compile.test.ts
```

Expected failure: `expected 'remove' to be 'append'` (and the `toHaveLength(3)` assertion in the first test also fails, since `id: id++` numbering doesn't change but the append rule still emits as one rule — the length assertion should already pass; the operation/value assertions on the new test are what fail).

3. Fix `src/lib/compile.ts`. Replace lines 51-58 (the `action` object) — currently:

```ts
        action: {
          type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [{
            header: rule.name.toLowerCase(),
            operation: (rule.op === "set" ? "set" : "remove") as chrome.declarativeNetRequest.HeaderOperation,
            ...(rule.op === "set" ? { value: sanitizeHeaderValue(rule.value ?? "") } : {}),
          }],
        },
```

with:

```ts
        action: {
          type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: [{
            header: rule.name.toLowerCase(),
            operation: rule.op as chrome.declarativeNetRequest.HeaderOperation,
            ...(rule.op !== "remove" ? { value: sanitizeHeaderValue(rule.value ?? "") } : {}),
          }],
        },
```

(`HeaderOp`'s three values — `"set" | "remove" | "append"` — are now string-identical to DNR's `HeaderOperation`'s three values, so `rule.op` passes straight through instead of being ternary-mapped; the value clause switches from an allowlist of one (`"set"`) to a denylist of one (`"remove"`), covering both `"set"` and `"append"`.)

4. Run the file again — confirm it passes:

```
npx vitest run src/lib/compile.test.ts
```

Expected: all tests pass, including the new append test.

5. Run the full suite to confirm no regressions elsewhere:

```
npx vitest run
```

6. Commit:

```
git add src/lib/compile.ts src/lib/compile.test.ts
git commit -m "Compile append header rules to DNR's native append operation"
```

---

## Task 3 — `share.ts` admits `"append"` in `validateRule`

`src/lib/share.ts:28` currently reads:

```ts
  if (o.op !== "set" && o.op !== "remove") throw new Error("A header rule has an invalid operation");
```

1. Add a test to `src/lib/share.test.ts`. In the `describe("share round-trip", ...)` block, after the `"global bundle round-trips all profiles"` test (ends at line 31, right before `it("rejects bad prefix"...)` at line 32), insert:

```ts
  it("round-trips an append rule", () => {
    const appendProfile: Profile = {
      id: "abc2", name: "Compression", enabled: true,
      matcher: { mode: "domain", value: "example.com" },
      rules: [{ id: "r2", enabled: true, op: "append", name: "Accept-Encoding", value: "br" }],
    };
    const s = encodeShare({ kind: "p", profile: appendProfile });
    const out = decodeShare(s);
    if (out.kind !== "p") throw new Error("kind");
    expect(out.profile.rules[0].op).toBe("append");
    expect(out.profile.rules[0].value).toBe("br");
  });
```

Also confirm the existing rejection test at lines 68-72 (`"rejects a rule with an invalid operation"`, using `op: "hack"`) is untouched — it should still throw after this change, since `"hack"` is still not one of the three valid values.

2. Run the file — expect the new test to fail with the existing error message, since `share.ts` still rejects `op: "append"`:

```
npx vitest run src/lib/share.test.ts
```

Expected failure: `Error: A header rule has an invalid operation`.

3. Fix `src/lib/share.ts` line 28:

```ts
  if (o.op !== "set" && o.op !== "remove" && o.op !== "append") throw new Error("A header rule has an invalid operation");
```

4. Run the file again — confirm it passes, including the pre-existing `"hack"`-rejection test:

```
npx vitest run src/lib/share.test.ts
```

5. Run the full suite:

```
npx vitest run
```

6. Commit:

```
git add src/lib/share.ts src/lib/share.test.ts
git commit -m "Accept append rules in share-string validation"
```

---

## Task 4 — `HeaderRow.tsx`: dropdown option, blocking-error check, help icon

`entrypoints/options/HeaderRow.tsx` currently has (line 19-26):

```ts
export function ruleHasBlockingError(rule: HeaderRule): boolean {
  if (rule.matcher && regexError(rule.matcher.mode, rule.matcher.value)) return true;
  const v = (rule.value ?? "").trim();
  if (rule.op === "set" && (v.startsWith("{") || v.startsWith("["))) {
    if (!validateJson(v).valid) return true;
  }
  return false;
}
```

and (lines 203-222):

```tsx
        <select
          class={`select select-op ${rule.op === "remove" ? "op-danger" : ""}`}
          value={rule.op}
          onChange={(e) => onChange({ ...rule, op: (e.target as HTMLSelectElement).value as HeaderRule["op"] })}
        >
          <option value="set">Set</option>
          <option value="remove">Remove</option>
        </select>
        <input
          type="text"
          class="input input-mono header-name-input"
          value={rule.name}
          placeholder="Header-Name"
          onInput={(e) => onChange({ ...rule, name: (e.target as HTMLInputElement).value })}
        />
        {rule.op === "remove" ? (
          <div class="value-input value-disabled">no value for Remove</div>
        ) : (
          <ValueEditor rule={rule} onChange={(value) => onChange({ ...rule, value })} onEditing={onEditing} />
        )}
```

### 4a — extend `ruleHasBlockingError` to `append`

1. Add a test to `entrypoints/options/HeaderRow.test.tsx`, in the `describe("ruleHasBlockingError", ...)` block, right after the existing `"is true when a set value looks like JSON but doesn't parse"` test (line 19-21):

```tsx
  it("is true when an append value looks like JSON but doesn't parse", () => {
    expect(ruleHasBlockingError({ ...baseRule(), op: "append", value: "{nope}" })).toBe(true);
  });
```

2. Run the file — expect a failure, since `ruleHasBlockingError` only checks `rule.op === "set"`:

```
npx vitest run entrypoints/options/HeaderRow.test.tsx
```

Expected: `expected false to be true`.

3. Fix `HeaderRow.tsx` line 22:

```ts
  if ((rule.op === "set" || rule.op === "append") && (v.startsWith("{") || v.startsWith("["))) {
```

4. Run the file again — confirm it passes:

```
npx vitest run entrypoints/options/HeaderRow.test.tsx
```

### 4b — third dropdown option, value field stays enabled, help icon

The value-field branch already keys off `rule.op === "remove"` (line 218), so `"append"` falls into the `else` (`<ValueEditor>`) branch with no code change needed there — confirmed by reading the branch, no test needed for that part since it's unchanged behavior for a new input value.

1. Add a rendering test to `entrypoints/options/HeaderRow.test.tsx`. In the `describe("HeaderRow blocked state", ...)` block (or a new `describe`), add:

```tsx
describe("HeaderRow append option", () => {
  it("renders an Append option in the op select", () => {
    const { container } = render(<HeaderRow rule={baseRule()} onChange={() => {}} onDelete={() => {}} />);
    const options = Array.from(container.querySelectorAll(".select-op option")).map((o) => o.textContent);
    expect(options).toEqual(["Set", "Append", "Remove"]);
  });
  it("shows a value editor (not the disabled placeholder) for an append rule", () => {
    const rule: HeaderRule = { ...baseRule(), op: "append" };
    const { container } = render(<HeaderRow rule={rule} onChange={() => {}} onDelete={() => {}} />);
    expect(container.querySelector(".value-disabled")).toBeNull();
  });
  it("renders a help icon with a title explaining append semantics", () => {
    const { container } = render(<HeaderRow rule={baseRule()} onChange={() => {}} onDelete={() => {}} />);
    const help = container.querySelector(".help-icon");
    expect(help).toBeTruthy();
    expect(help!.getAttribute("title")).toMatch(/comma/i);
  });
});
```

2. Run the file — expect all three new tests to fail: no `Append` option exists yet, and no `.help-icon` element exists yet (the value-editor test may already pass since `"append"` already falls into the non-`"remove"` branch, but run it now to confirm before touching that code):

```
npx vitest run entrypoints/options/HeaderRow.test.tsx
```

3. Fix `HeaderRow.tsx`. Replace the `<select>...</select>` block (lines 203-210):

```tsx
        <select
          class={`select select-op ${rule.op === "remove" ? "op-danger" : ""}`}
          value={rule.op}
          onChange={(e) => onChange({ ...rule, op: (e.target as HTMLSelectElement).value as HeaderRule["op"] })}
        >
          <option value="set">Set</option>
          <option value="append">Append</option>
          <option value="remove">Remove</option>
        </select>
        {rule.op === "append" && (
          <span
            class="help-icon"
            title="Adds this value onto the header's existing value using a comma, rather than replacing it. If the header doesn't already have a value, this behaves like Set. Not supported: a custom separator, or combining with headers whose own syntax doesn't use commas (e.g. Cookie)."
          >
            ?
          </span>
        )}
```

(The help icon only renders when `Append` is selected — it explains the option that's active, rather than sitting there unconditionally for every op.)

4. Run the file again — confirm the dropdown-options and value-editor tests pass, but the help-icon test still fails (element only renders when `rule.op === "append"`, and `baseRule()` is `op: "set"`). Fix the test fixture: change the help-icon test's `render(<HeaderRow rule={baseRule()} .../>)` to use an append rule:

```tsx
  it("renders a help icon with a title explaining append semantics", () => {
    const rule: HeaderRule = { ...baseRule(), op: "append" };
    const { container } = render(<HeaderRow rule={rule} onChange={() => {}} onDelete={() => {}} />);
    const help = container.querySelector(".help-icon");
    expect(help).toBeTruthy();
    expect(help!.getAttribute("title")).toMatch(/comma/i);
  });
```

5. Run the file again — confirm all three new tests pass:

```
npx vitest run entrypoints/options/HeaderRow.test.tsx
```

6. Add the `.help-icon` CSS rule to `entrypoints/options/style.css`, matching `.btn-icon-sm`'s sizing/border and `.helper`'s muted-text color (existing rule blocks for reference: `.btn-icon-sm` is `width: 26px; height: 28px; border-radius: 7px; background: var(--surface); border: 1px solid var(--border); color: var(--muted); font-size: 12px;`; `.helper` is `font-size: 10.5px; color: var(--muted);`). Add near `.btn-icon-sm` (after its closing brace):

```css
.help-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--muted);
  font-size: 10.5px;
  cursor: help;
  flex: none;
}
```

7. Run the full suite:

```
npx vitest run
```

8. Commit:

```
git add entrypoints/options/HeaderRow.tsx entrypoints/options/HeaderRow.test.tsx entrypoints/options/style.css
git commit -m "Add Append option to the header rule editor with a help tooltip"
```

---

## Task 5 — ModHeader converter maps `appendMode` to `op: "append"`

`src/lib/modheader.ts` currently has, inside the `for (const h of mhHeaders)` loop (lines 103-116):

```ts
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
```

The existing test at `src/lib/modheader.test.ts:127-136` currently asserts:

```ts
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
```

### 5a — appendMode maps to `op: "append"`, no warning for a generic header

1. Rewrite the existing test above to:

```ts
  it("maps a header with appendMode to an append rule, no warning for a generic header", () => {
    const { config, warnings } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: "x" }],
        headers: [{ name: "X-App", value: "v", enabled: true, appendMode: true }],
      }],
    });
    expect(config.profiles[0].rules).toEqual([
      { id: "", enabled: true, op: "append", name: "X-App", value: "v" },
    ]);
    expect(warnings).not.toContainEqual(expect.stringContaining("X-App"));
  });
```

2. Run the file — expect a failure, since `modheader.ts` still always emits `op: "set"` plus the old warning text:

```
npx vitest run src/lib/modheader.test.ts
```

Expected: the `toEqual` assertion fails (`op: "set"` instead of `"append"`), and/or the `not.toContainEqual` assertion fails (old warning is present).

3. Fix `src/lib/modheader.ts`. Replace lines 103-116 with:

```ts
    for (const h of mhHeaders) {
      const hname = typeof h?.name === "string" ? h.name : "";
      if (hname.trim() === "") continue;
      const op = h.appendMode === true ? "append" : "set";
      if (op === "append" && NON_STANDARD_COMBINE_HEADERS.has(hname.toLowerCase())) {
        warnings.push(
          `Profile "${name}" header "${hname}": append uses Chrome's comma-join, which ${hname} does not combine safely — verify server behavior.`,
        );
      }
      rules.push({
        id: "",
        enabled: h.enabled !== false,
        op,
        name: hname,
        value: String(h.value ?? ""),
      });
    }
```

Add the `NON_STANDARD_COMBINE_HEADERS` constant near the top of the file, after the `MhProfile` interface (after line 41, before the `convertModHeader` export at line 49):

```ts
const NON_STANDARD_COMBINE_HEADERS = new Set(["cookie", "set-cookie", "authorization"]);
```

4. Run the file again — confirm the rewritten test passes:

```
npx vitest run src/lib/modheader.test.ts
```

### 5b — targeted warning for Cookie/Set-Cookie/Authorization

1. Add a new test to `src/lib/modheader.test.ts`, right after the rewritten test from 5a:

```ts
  it("warns when appendMode targets a header with non-standard combine semantics", () => {
    const { warnings } = convertModHeader({
      profiles: [{
        title: "A",
        urlFilters: [{ enabled: true, urlRegex: "x" }],
        headers: [
          { name: "Cookie", value: "a=1", enabled: true, appendMode: true },
          { name: "authorization", value: "Bearer x", enabled: true, appendMode: true },
        ],
      }],
    });
    expect(warnings).toContainEqual(
      'Profile "A" header "Cookie": append uses Chrome\'s comma-join, which Cookie does not combine safely — verify server behavior.',
    );
    expect(warnings).toContainEqual(
      'Profile "A" header "authorization": append uses Chrome\'s comma-join, which authorization does not combine safely — verify server behavior.',
    );
  });
```

2. Run the file — this should already pass given the 5a implementation (the `NON_STANDARD_COMBINE_HEADERS` check and warning were added together in 5a's fix). Confirm:

```
npx vitest run src/lib/modheader.test.ts
```

If it fails, the most likely cause is the case-sensitivity of the `.has()` lookup — `hname.toLowerCase()` against the lowercase-seeded `Set` should already handle `"Cookie"` and `"authorization"` correctly; re-check the constant's contents match exactly `["cookie", "set-cookie", "authorization"]`.

3. Run the full suite:

```
npx vitest run
```

4. Commit:

```
git add src/lib/modheader.ts src/lib/modheader.test.ts
git commit -m "Map ModHeader appendMode to the append operation with a targeted combine-safety warning"
```

---

## Self-review

**Spec coverage:**
- Data model (`HeaderOp` third value) — Task 1.
- DNR compilation pass-through — Task 2.
- Share-string validation — Task 3.
- Editor UX (dropdown option, help tooltip, value field, JSON blocking-check) — Task 4.
- ModHeader converter mapping + targeted warning — Task 5.
- CONTEXT.md glossary — already done in this conversation (spec's Components table notes this explicitly).
- ADR 0007 — already written in this conversation.
- Error handling (DNR ordering constraint relies on the existing generic rejection-banner path) — no code change required per spec; nothing to add a task for.
- Out-of-scope items (custom separator, proactive priority-conflict validation, exhaustive header list, response headers, live log changes) — confirmed no tasks touch these.

**Placeholder scan:** no `TBD`/`TODO`/"similar to Task N" — every task repeats full code. No task references a type or function not defined in this plan or already in the codebase (`sanitizeHeaderValue`, `regexError`, `validateJson`, `isMatchMode` are pre-existing and unchanged).

**Type consistency:** `HeaderOp = "set" | "remove" | "append"` (Task 1) is the single source used identically in Tasks 2-5; `NON_STANDARD_COMBINE_HEADERS` is defined once (Task 5) and used once; `.help-icon` class name is consistent between the TSX (Task 4b step 3) and CSS (Task 4b step 6).
