# Header Handler — Chrome Web Store Listing Pack

Copy-paste source for the CWS Developer Dashboard, ordered to match the dashboard
form field-by-field. Two tabs: **Store listing** and **Privacy**. Draft — review
before publishing.

> ⚠️ **Data-usage stance is deliberate.** Header Handler transmits *nothing*
> off-device, so a strict reading of Google's "collect = transmit off device"
> would let you answer **"I don't collect user data."** We instead **declare**
> Authentication information + Web history and rely on the Limited-Use
> certification, because the live log *reads* sensitive headers
> (`Authorization` / `Cookie`) and matched URLs — declaring is the conservative,
> defensible choice under review. If you prefer the strict reading, you can flip
> the Data-usage section to "does not collect"; decide before submitting. See the
> Data usage section for the per-category answers.

---

# Store listing tab

## Item name / title (max 75 chars)

`Header Handler` (15 chars) — generic, no trademark conflict.

## Summary (short description, max 132 chars)

`Add, overwrite, and remove request headers with shareable profiles.` (70 chars) — matches the manifest `description`.

## Description (max 16,000 chars)

> **A simple, open-source header editor. No accounts, no tracking, no servers, no mess.**
>
> Header Handler adds, overwrites, and removes HTTP request headers — that's it.
> It's fully open source, makes no network requests of its own, phones home to
> nothing, and runs no remotely hosted code. Nothing you configure ever leaves
> your machine. Install it, set a rule, done.
>
> You define named **profiles**, each with a URL matcher and a list of header
> rules (**Set** or **Remove**). Multiple profiles can be active at once; the
> applied rule set is the union of everything enabled.
>
> **Shareable in one string.** Every profile — or your whole setup — exports to
> a single copy-paste string. Send it to a teammate or paste it into another
> browser and they have the exact same rules in seconds. No sign-up, no sync
> account, no config files to pass around.
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
> **Where your data lives (all on-device).**
> • Profiles and rules are stored in Chrome's own synced storage
>   (`chrome.storage.sync`) — the same mechanism as bookmarks.
> • The live log lives only in memory for the browser session
>   (`chrome.storage.session`) and is never written to disk.
> • Everything ships in the extension package — no remotely hosted code.
>
> **Scope note (by design):** the live log uses read-only `webRequest`
> observation to reconstruct which rules applied — Manifest V3 doesn't expose
> per-request rule-match ground truth to a published extension. The actual
> header rewriting is done entirely by `declarativeNetRequest`, not by
> `webRequest`.
>
> Open source — https://github.com/curtyo18/header-handler

## Category

**Developer Tools**

## Language

**English (United Kingdom)** — or en-US; match your dashboard default.

## Store icon (128×128)

`public/icons/128.png` (already generated and committed).

## Screenshots (≥1 required; 1280×800 or 640×400)

Three 1280×800 PNGs are ready in `docs/store/screenshots/` — upload directly:

- `01-options.png` — Options page: a profile's matcher + header-rules table, one rule editing a JSON value.
- `02-popup.png` — popup: master switch above per-profile toggles.
- `03-live-log.png` — side panel: a matched request with per-rule chips.

## Homepage URL

`https://github.com/curtyo18/header-handler`

## Support URL

`https://github.com/curtyo18/header-handler/issues`

---

# Privacy tab

## Single purpose description (required)

> Header Handler lets the user define named profiles of Set/Remove rules for
> HTTP request headers, matched by URL, and applies them to outgoing requests
> via `declarativeNetRequest`. Rewriting request headers per user-defined rules
> is its single purpose.

## Permission justifications (one field per permission)

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

## Are you using remote code?

**No.** All executable code ships inside the package; no `<script src>` to a CDN,
no `eval`, no remotely hosted modules. (No justification field required.)

## Data usage

Certification preamble (Google's text, shown for reference):

> The content of this form will be displayed publicly on the item detail page.
> By publishing your item, you are certifying that these disclosures reflect the
> most up-to-date content of your privacy policy.

### What user data do you plan to collect? (per category)

| Category | Collected? | Rationale |
| --- | --- | --- |
| Personally identifiable information | **No** | Never handled. |
| Health information | **No** | Never handled. |
| Financial and payment information | **No** | Never handled. |
| **Authentication information** | **Yes** | The live log can *observe* `Authorization` / `Cookie` request headers for a request matching an enabled rule. On-device only (in-memory session storage), never transmitted, sold, or transferred. |
| Personal communications | **No** | Never handled. |
| Location | **No** | No GPS/IP/region handling. |
| **Web history** | **Yes** | Matched request URLs surface in the live log, and the toolbar badge reads the active tab's URL (via host access) to count how many profiles apply. On-device only, never transmitted. |
| User activity | **No** | See note — the live log observes *matched* network requests only; we classify that under Web history rather than declaring generic activity monitoring. |
| Website content | **No** | Rules touch only the specific request headers the user configures; response bodies and page content are never read. |

> **Judgment calls to confirm before you submit:**
> - *Authentication / Web history* are declared conservatively even though nothing leaves the device. Flip both to "No" if you adopt the strict "collect = transmit off-device" reading.
> - *User activity*'s example text includes "network monitoring." The live log does observe matched requests; we keep it under **Web history** (it's the request URLs + which rule matched), not generic activity logging. If a reviewer pushes back, adding **User activity** is the safe escalation.

### Certification checkboxes (all three apply — check all)

- [x] I do **not** sell or transfer user data to third parties, outside of the approved use cases. *(Nothing is transferred at all.)*
- [x] I do **not** use or transfer user data for purposes unrelated to my item's single purpose.
- [x] I do **not** use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

`https://curtyo18.github.io/header-handler/privacy.html`
*(Served via GitHub Pages — Settings → Pages → source `main` / `/docs`. Confirm it renders in a browser before submitting.)*

## Notes for reviewers (paste into the "notes to reviewer" field)

> Lead facts: **no `debugger`, no remotely hosted code.** Header rewriting is
> done entirely by `declarativeNetRequest` dynamic rules compiled from the
> user's own profile/rule configuration — nothing is rewritten based on remote
> input. `webRequest` is used strictly read-only (non-blocking) to power an
> in-session live log that reconstructs which rules matched a request, using
> the same matcher module that compiles the DNR rules. For the five string
> matcher modes the log tracks the compiled rule exactly; regex mode is
> evaluated by JS `RegExp` for the log and RE2 for the actual DNR rule, so a
> regex rule can diverge between the log and reality. The log (which can
> include sensitive headers like Authorization/Cookie for matched requests)
> lives only in `chrome.storage.session` — in-memory, cleared on browser close,
> never transmitted anywhere. Profile/rule config lives in
> `chrome.storage.sync`. Broad host access is required because the user
> configures which sites their own rules target.

---

## Submission checklist

- [ ] MV3 package built at the current `package.json` version — the latest `.output/header-handler-<version>-chrome.zip` from `npm run zip`
- [ ] Privacy policy live — GitHub Pages (`main` / `/docs`), confirmed rendering in a browser
- [x] 128×128 icon present (`public/icons/128.png`)
- [x] ≥1 screenshot — three 1280×800 shots in `docs/store/screenshots/`
- [ ] CWS developer account + $5 fee + 2-Step Verification + verified contact email
- [ ] **Store listing tab:** name, summary, description, category, language, icon, screenshots, homepage URL, support URL
- [ ] **Privacy tab:** single-purpose, per-permission justifications, remote-code = No, data-usage per-category + three certifications + policy URL, reviewer notes
- [ ] Data-usage decision confirmed (declare auth-info + web-history, **or** strict "does not collect")
- [ ] Upload zip + screenshots + icon → Submit
- [ ] Do NOT upload older-version zips (anything below the current version)
