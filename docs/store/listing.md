# Header Handler — Chrome Web Store Listing Pack

Copy-paste source for the CWS Developer Dashboard. Draft — review before publishing.

> ⚠️ **Data-use answer is deliberately NOT "does not collect."** The live log
> reads request headers — including `Authorization` / `Cookie` — for any
> request matching an enabled rule. That never leaves the device, but CWS
> counts reading sensitive headers as handling sensitive data regardless. See
> the Data usage section below — declare the data types and rely on the
> Limited Use certification, same pattern as network-data-viewer.

---

## Store item name (max 75 chars)

`Header Handler` (15 chars) — generic, no trademark conflict.

## Summary / short description (max 132 chars)

Current manifest: `Add, overwrite, and remove request headers with shareable profiles.` (70 chars — fine).

## Category

**Developer Tools**

## Language

**English (United Kingdom)** (or en-US — match your dashboard default)

## Single-purpose description (required, Privacy tab — separate field)

> Header Handler lets the user define named profiles of Set/Remove rules for
> HTTP request headers, matched by URL, and applies them to outgoing requests
> via `declarativeNetRequest`. Rewriting request headers per user-defined rules
> is its single purpose.

## Detailed description (max 16,000 chars)

> **Add, overwrite, and remove request headers — organized into shareable profiles.**
>
> Header Handler lets you define named **profiles**, each with a URL matcher
> and a list of header rules (**Set** or **Remove**). Multiple profiles can be
> active at once; the applied rule set is the union of everything enabled.
>
> **Built for local development and debugging.** Inject `Authorization` or API
> key headers into requests without a proxy, strip or override `Origin` /
> `Referer` / `Cookie` per site, and scope rules with six matcher modes
> (Contains, Exact, Starts with, Ends with, Domain, Custom regex) — with an
> optional per-rule override matcher for one-off exceptions.
>
> **See what actually matched.** A side panel live log lists requests touched
> by your active rules, with the observed headers for that request — added or
> changed headers highlighted against the rest. Session-only; cleared when the
> browser closes or on demand.
>
> **Share your setup.** Export a single profile or your whole config as a
> compressed, versioned text string. Paste it into another browser (or share
> it with a teammate) to install the same rules via Import.
>
> **No servers, no telemetry.**
> • Profiles and rules are stored in Chrome's own synced storage
>   (`chrome.storage.sync`) — the same mechanism as bookmarks.
> • The live log lives only in memory for the browser session
>   (`chrome.storage.session`) and is never written to disk.
> • Header Handler makes no network requests of its own, phones home to
>   nothing, and runs no remotely hosted code — everything ships in the
>   extension package.
>
> **Scope note (by design):** the live log uses read-only `webRequest`
> observation to reconstruct which rules applied — Manifest V3 doesn't expose
> per-request rule-match ground truth to a published extension. The actual
> header rewriting is done entirely by `declarativeNetRequest`, not by
> `webRequest`.
>
> Open source — <https://github.com/curtyo18/header-handler>

## Screenshots (≥1 required; 1280×800 or 640×400)

- **Needed:** render `docs/screenshot-mock.html` (already sized 1280×800) to a
  PNG/JPG — it's currently HTML, not an uploadable image.
- **Recommended composition** (matches the existing mock): popup with a couple
  of profiles toggled on; Options page with a profile's matcher + header rules
  table; side panel with an expanded log entry showing highlighted matched
  headers.

Store icon 128×128 is already present (`public/icons/128.png`).

## Privacy policy URL

`https://curtyo18.github.io/header-handler/privacy.html`
*(Needs GitHub Pages enabled — Settings → Pages → source: `main` / `/docs`,
same as network-data-viewer and StopYappingBro. Confirm it renders in a
browser before submitting.)*

---

## Privacy practices tab

### Permission justifications

**`declarativeNetRequest`**
> Compiles the user's enabled profiles and header rules into dynamic DNR rules,
> which is the Manifest V3 mechanism that actually adds, overwrites, or removes
> request headers. This is the extension's core function.

**`webRequest`**
> Used read-only (non-blocking) to feed the live log: observed requests are
> re-evaluated against the same matcher logic that compiles the DNR rules, so
> the log reflects which rules *should* have applied. It never blocks,
> redirects, or modifies a request — all rewriting happens via
> `declarativeNetRequest` above.

**`storage`**
> Stores user-created profiles and header rules (`chrome.storage.sync`, so they
> follow the user's signed-in Chrome like bookmarks) and the live log
> (`chrome.storage.session`, in-memory only, cleared on browser close). No data
> is transmitted off-device.

**`sidePanel`**
> Renders the live log — the extension's view into which requests its rules
> touched — in Chrome's side panel surface. Without it there is no UI for the
> log.

**Host permissions — `<all_urls>`** *(the one needing the most care)*
> The user defines which sites their profiles apply to via matchers (Contains,
> Exact, Starts with, Ends with, Domain, Custom regex); a fixed host list in
> the manifest would prevent the user from targeting arbitrary sites of their
> own choosing, which is the entire point of a general-purpose header tool.
> DNR rules only add/overwrite/remove the specific headers the user configured
> — they don't read response bodies or page content.

### Data usage disclosures ⚠️ (the important part)

- **Remote code:** **No** — all code is bundled.
- **Does this item collect or use user data?** **Yes — declare the data types
  it handles**, do NOT claim "does not collect":
  - **Authentication information** (the live log can observe
    `Authorization` / `Cookie` headers on requests matching an enabled rule).
  - **Web history** (matched request URLs appear in the live log).
- **Certify the Limited Use commitment:** data is **processed locally on the
  user's device, never transmitted off-device, never sold, and never
  transferred** for any purpose other than the user's own inspection.
- **Certification checkboxes:** affirm all three.

### Reviewer notes (paste into the "notes to reviewer" field)

> Lead facts: **no `debugger`, no remotely hosted code.** Header rewriting is
> done entirely by `declarativeNetRequest` dynamic rules compiled from the
> user's own profile/rule configuration — nothing is rewritten based on remote
> input. `webRequest` is used strictly read-only (non-blocking) to power an
> in-session live log that reconstructs which rules matched a request, using
> the same matcher module that compiles the DNR rules, so the log can't drift
> from what the rules actually do. The log (which can include sensitive
> headers like Authorization/Cookie for matched requests) lives only in
> `chrome.storage.session` — in-memory, cleared on browser close, never
> transmitted anywhere. Profile/rule config lives in `chrome.storage.sync`.
> Broad host access is required because the user configures which sites their
> own rules target.

---

## Submission checklist (HH)

- [ ] MV3 package built at current version (0.1.4) — `.output/header-handler-0.1.4-chrome.zip`
- [ ] Privacy policy hosted — enable GitHub Pages (Settings → Pages → `main` / `/docs`), confirm it renders in browser
- [x] 128×128 icon present (`public/icons/128.png`)
- [ ] ≥1 screenshot — render `docs/screenshot-mock.html` to PNG/JPG first
- [ ] CWS developer account + $5 fee + 2-Step Verification + verified contact email (user)
- [ ] Category / language / visibility set in dashboard
- [ ] Paste summary, detailed description, single-purpose, permission
      justifications, reviewer notes
- [ ] Data-use: **declare auth-info + web-history, certify Limited Use** (NOT "does not collect")
- [ ] Upload zip + screenshot + icon → Submit
- [ ] Do NOT upload older-version zips (anything below the current version)
