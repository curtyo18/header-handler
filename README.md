# Header Handler

Chrome extension that adds, overwrites, and removes HTTP request headers using rules organized into shareable **profiles**. Each profile has a URL matcher and a list of Set/Remove header rules; multiple profiles can be active at once. A side panel shows a live log of the requests your rules touched.

## What it's for

- Injecting `Authorization` / API-key headers into requests during local development
- Stripping or overriding headers (e.g. `Origin`, `Referer`, `Cookie`) per site without a proxy
- Sharing a header-rewriting setup with a teammate as a short text string, instead of screenshots of settings

## Install

Load a release build unpacked — download the latest `header-handler-X.Y.Z.zip` from [Releases](../../releases), unzip, then in Chrome:

1. Visit `chrome://extensions`
2. Enable Developer Mode (top right)
3. Click "Load unpacked"
4. Select the unzipped folder

Open the popup from the toolbar icon to toggle profiles; open Options (gear icon) to edit them.

## Concepts

### Profiles and header rules

A **profile** bundles a default **matcher** (which requests it applies to) and a list of **header rules**. Each rule is a Set or Remove operation on one header name, and may carry its own matcher that overrides the profile's for that rule only. The applied rule set at any time is the union of all enabled profiles.

### Matchers

A matcher decides which requests a profile or rule applies to, using one of six modes: Contains, Exact, Starts with, Ends with, Domain, or Custom regex.

### Live log

The side panel lists requests that matched any active rule, with the headers observed for that request — rules that added/changed a header are highlighted against the rest. It's a reconstruction (evaluated with the same matcher logic that compiles the rules), not proof of what `declarativeNetRequest` actually did per request; Chrome's Manifest V3 platform doesn't expose that to a published extension. See [`docs/adr/0001-webrequest-observer-for-live-log.md`](docs/adr/0001-webrequest-observer-for-live-log.md) for why.

The log is session-only, held in memory, and never persisted or transmitted anywhere.

### Sharing

Export a single profile or your whole config as a compressed, URL-safe string prefixed `HH1p…` (single profile) or `HH1g…` (all profiles). Paste it into another browser via Import to install the same set. Local ids are stripped on export and regenerated on import. See [`docs/adr/0002-versioned-lzstring-share-format.md`](docs/adr/0002-versioned-lzstring-share-format.md) for the format's versioning guarantee.

### Storage

Profiles and the master on/off switch persist via `chrome.storage.sync` (so they follow you across signed-in Chrome instances, like bookmarks). The live log uses `chrome.storage.session` and is cleared when the browser closes, or manually via the Clear button.

## Permissions

The extension requests:

- `declarativeNetRequest` — compiles enabled profiles/rules into dynamic rules that actually rewrite request headers
- `webRequest` — read-only observation feeding the live log (see ADR 0001)
- `storage` — persist profiles/config (`sync`) and the live log (`session`)
- `sidePanel` — render the live log in Chrome's side panel surface
- Host access to `<all_urls>` — rules can target any site; a fixed domain list would defeat the point of a general-purpose header tool

Header Handler makes no network requests of its own, runs no remote code, and has no telemetry.

See `docs/privacy.html` for the full privacy policy and `docs/store/listing.md` for the Chrome Web Store submission pack (dashboard copy and permission justifications).

## Development

```bash
npm install
npm run icons       # generate icons from assets/icon.svg
npm run dev         # WXT dev (HMR) → .output/chrome-mv3
npm run build       # production build → .output/chrome-mv3
npm test            # vitest unit tests
npm run zip         # build + zip → .output/header-handler-X.Y.Z-chrome.zip
```

Load the built `.output/chrome-mv3` via `chrome://extensions` → "Load unpacked" while iterating.

### Architecture

Popup and Options edit the `Profile[]` config in `chrome.storage.sync`; on any change, `src/lib/compile.ts` recompiles it into `declarativeNetRequest` dynamic rules in the background service worker. A separate, non-blocking `webRequest` listener re-evaluates the same config against observed requests (via `src/lib/matcher.ts`, shared with compilation so the log and the real rules can't drift) and forwards matches to the side panel.

Full design in [`specs/2026-07-11-header-handler-design.md`](specs/2026-07-11-header-handler-design.md).

## Contributing

- Branch off `main`. Open a PR.
- Run the test bar before pushing: `npm test`.
- Bug reports welcome via Issues.

## License

[MIT](./LICENSE) © 2026 Curt
