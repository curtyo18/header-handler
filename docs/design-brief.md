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
