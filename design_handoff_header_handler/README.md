# Handoff: Header Handler — Chrome Extension UI

## Overview
Header Handler is a Chrome extension (Manifest V3) that adds, overwrites, and removes
HTTP **request** headers using shareable **profiles**. A profile bundles a URL matcher
plus a set of header rules; multiple profiles can be active at once. This handoff covers
the three user-facing surfaces: the toolbar **Popup**, the full-tab **Options page**, and
the docked **Side panel** (live log).

The extension is **dark-only** (`color-scheme: dark`, no light mode).

## About the Design Files
The file in this bundle (`Header Handler Mock.dc.html`) is a **design reference created
in HTML** — a high-fidelity prototype of the intended look and behavior, **not production
code to copy directly**. It is a single composite frame showing all three surfaces side by
side over a faint mock browser (built for a 1280×800 Chrome Web Store screenshot).

Your task is to **recreate these designs inside the extension codebase** using its
established patterns. For a Chrome MV3 extension the natural stack is:
- Popup → `popup.html` + a small framework (vanilla, Preact, or React — match whatever the
  repo already uses).
- Options → `options.html` (full tab).
- Side panel → `sidepanel.html` via the `chrome.sidePanel` API.
- Header rewriting → `chrome.declarativeNetRequest` dynamic rules (preferred) and/or a
  service worker. The live log reads request events (e.g. `webRequest.onSendHeaders` in a
  dev/observe context) — confirm against the manifest permissions the project already
  requests.

If no codebase exists yet, scaffold a standard MV3 extension and implement the surfaces there.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and control treatments are final. Recreate
the UI pixel-closely using the exact tokens below. The composite is a presentation layout;
in the real extension each surface renders on its own at the sizes noted per section.

---

## Screens / Views

### 1. Popup (360 × 420 px — opens from toolbar icon)
- **Purpose:** quick on/off control. Master switch for the whole extension + per-profile
  toggles, without leaving the current tab.
- **Layout:** vertical flex, three regions.
  - **Header** (padding 14px, bottom border `#17171b`): app icon (26px rounded square,
    surface bg, 3 stacked bars — top bar accent, others muted), title "Header Handler"
    (13.5px / 650 weight) with subtitle "Modify request headers" (10.5px muted). On the
    right, the **master ON/OFF switch** (46×26 pill; ON = accent bg with 20px dark knob at
    right + subtle accent glow).
  - **Profile list** (scrollable, 8px padding, 6px gap): one row per profile. Each row is a
    surface card (`#141417`, border `#22222a`, radius 9px, padding 10×12): left = profile
    name (12.5px / 550) + count line ("3 rules enabled", 10.5px muted); right = a 34×20
    toggle. **Toggles, not radios** — multiple profiles can be ON simultaneously. A disabled
    profile row is dimmed (opacity .72, muted track) and reads "1 rule · off".
  - **Footer** (padding 10px, top border): full-width "Open live log" button (surface bg,
    accent text/border `#33465f`, opens the side panel) + a 32px square gear "Options" button.
- **Empty state (no profiles):** centered short line + a "Create a profile" button
  (accent). *Not shown in the composite — implement per copy in Interactions.*

### 2. Options page (full browser tab, content max-width ~980px, centered)
- **Purpose:** create and edit profiles, their URL matcher, and their header rules;
  import/export profiles.
- **Layout:** page top bar + two-column body.
  - **Top bar** (padding 16px, bottom border): app icon + "Header Handler" wordmark (15px /
    650) on the left. On the right: **Import** button (surface) and **Export ▾** button
    (accent-outlined). Export opens a dropdown menu (190px, surface, radius 9px) with
    "Export this profile" (active/hover row `#1c1c21`) and "Export all profiles".
  - **Left column** (172px, right border): "Profiles" label (10px uppercase muted), then a
    selectable list. Each item: 6px status dot (green `#5fd08a` = enabled, `#2a2a2e` = off)
    + name. Selected item has an accent-tinted bg `#1a2537` + border `#33465f`. Below the
    list: dashed "＋ New profile" button.
  - **Right column** (editor, scrollable, padding 16px, 16px gap between groups):
    1. **Name + Enabled:** "PROFILE NAME" label + text field (34px, surface); to the right a
       stacked "Enabled" label + 40×23 toggle (ON = accent).
    2. **URL MATCHER row:** a mode dropdown (132px) + value input (flex, monospace). Modes:
       **Contains / Exact / Starts with / Ends with / Domain / Custom regex**. A subtle
       monospace **example hint** sits under the row and **changes with the mode**
       (Contains → `api.example.com`, Regex → `^https://.*\.dev/`, etc.).
    3. **HEADER RULES table:** column header row (Op / Header / Value). Each rule is a card
       (`#0f0f12`, border `#22222a`, radius 9px). Per-row controls, left→right:
       - **Enabled checkbox** (16px; checked = accent bg with dark ✓; unchecked = empty with
         border `#3a3a40`).
       - **Op dropdown** (76px): **Set / Remove**. When op = **Remove**, the op text renders
         in danger `#f2777a`.
       - **Header-name input** (132px, monospace).
       - **Value input** (flex, monospace). **Wraps to multiple lines** for long values
         (`word-break: break-all`, `min-height:28px`) — see JSON note below. When op =
         **Remove**, the value cell is **disabled/greyed** (dashed border, italic muted
         placeholder "no value for Remove").
       - **Override-match expander** (26px ▾ button; accent-styled when active). Reveals a
         per-row matcher — the *same* mode-dropdown + value control as the profile matcher —
         in an indented panel below the row.
       - **Delete button** (26px, danger ×).
       - Below the table: dashed "＋ Add header" button.
    4. **Inline validation:** when the matcher (profile or per-row) uses **Custom regex** and
       the pattern is invalid, the value input gets a danger border `#f2777a` and a danger
       helper line below: "⚠ Invalid regular expression: …".
- **Import modal:** opens from the Import button. Contains a paste box (textarea) for JSON.
  On **name collision**, show an "Overwrite ‹name›?" confirm with **Overwrite / Cancel**;
  when importing a **global bundle** (multiple profiles), also offer an **"apply to all"**
  checkbox so the choice applies to every colliding profile. *Modal not shown open in the
  composite — implement per this spec.*

### 3. Side panel (docked right, ~360px wide, full height)
- **Purpose:** live, reverse-chronological log of requests matched by active profiles.
- **Layout:** header bar + scrollable list.
  - **Header** (padding 14px, bottom border): "Live log" title (13.5px / 650) + a "Clear"
    button (surface, 26px) on the right; below, a muted note "Session only · not persisted".
  - **Log entries** (10px padding, 8px gap): each entry is a card (`#0f0f12`, border
    `#22222a`, radius 9px, padding 10px).
    - **Line 1:** METHOD chip + truncated URL + time (10px muted, right-aligned).
      - Method chip colors: **GET** = success `#5fd08a`, **POST** = accent `#6ea8fe`,
        **DELETE** = danger `#f2777a` (chip = colored text on 12%-alpha bg of same hue,
        30%-alpha border, radius 5px, 9.5px / 750 weight). Add sensible colors for PUT/PATCH
        (e.g. PUT/PATCH = accent or an amber).
      - URL: host emphasised (`#e7e7e9`), path muted (`#8a8a90`), monospace, truncated with
        ellipsis (`text-overflow: ellipsis`, `white-space: nowrap`).
    - **Line 2:** small accent chips (10px, accent text on 10%-alpha bg, border 28% alpha,
      radius 5px) — one per matched profile/rule name. Added headers are prefixed with `+`
      (e.g. `+Authorization`).
    - **Expandable:** full request-header list (monospace, 10.5px, line-height 1.5). Headers
      **our rules matched/added are highlighted** — accent-tinted bg `rgba(110,168,254,.09)`,
      2px accent left border, header-name in accent; **all other headers are muted**
      (`#6a6a70`). Long values wrap (`word-break: break-all`).
  - **Empty state:** "No matched requests yet — enable a profile and browse." *Implement;
    not shown in composite.*

---

## JSON header values (design decision — implement)
Some users put JSON into a header value. **HTTP header values cannot contain literal
newlines**, so the design supports **editing pretty / storing minified**:
- The value cell **auto-detects JSON** and shows a `{ } JSON` badge (accent) + a **Format**
  button in a small toolbar above the value body.
- The body pretty-prints with light syntax coloring: keys accent `#6ea8fe`, string values
  success `#5fd08a`, numbers/text `#e7e7e9`, punctuation muted.
- A footer line shows validation + size: `✓ valid JSON · 63 bytes · sent minified → one line`.
- **On save the value is minified to a single line** before being written to the header.
  Invalid JSON shows a danger validation line (same pattern as the regex error).
- Show the **byte count** because headers have practical size caps (~8–16 KB); warn as it
  approaches the limit.

---

## Interactions & Behavior
- **Master switch (popup):** toggles the whole extension. When OFF, no rules apply and the
  side panel stops logging (existing entries remain until Clear).
- **Profile toggles:** independent on/off per profile (multiple active at once). Toggling
  updates the enabled dot in the Options left column and the count/state in the popup.
- **Profile selection (Options):** clicking a left-column item loads it into the editor.
- **Op = Remove:** disables + greys the value input; the rule strips the named header.
- **Override-match expander:** shows/hides a per-row matcher that overrides the profile
  matcher for that single rule.
- **Matcher hint:** the example text under a matcher updates live as the mode changes.
- **Regex validation:** validate `Custom regex` values on input; show inline danger error;
  block save while invalid.
- **JSON value:** validate + minify-on-save; "Format" re-pretty-prints for editing.
- **Import:** parse pasted JSON → detect collisions → Overwrite/Cancel (+ apply-to-all for
  bundles). **Export ▾:** "this profile" (single JSON) or "all profiles" (bundle JSON).
- **Open live log (popup footer):** opens the side panel (`chrome.sidePanel.open`).
- **Gear (popup footer):** opens the Options page (`chrome.runtime.openOptionsPage`).
- **Log entry expand/collapse:** reveals/hides the full header list.
- **Clear (side panel):** empties the session log.
- No elaborate animation is required; use short (~120–150ms ease) transitions on toggles,
  hovers, and expand/collapse.

## State Management
- `masterEnabled: boolean`
- `profiles: Profile[]` where
  `Profile = { id, name, enabled, matcher: Matcher, rules: HeaderRule[] }`
  - `Matcher = { mode: 'contains'|'exact'|'startsWith'|'endsWith'|'domain'|'regex', value: string }`
  - `HeaderRule = { id, enabled: boolean, op: 'set'|'remove', name: string, value: string, override?: Matcher }`
- `selectedProfileId: string` (Options)
- `log: LogEntry[]` (session-only, side panel) where
  `LogEntry = { id, method, url, time, matches: {profile: string, addedHeaders: string[]}[], requestHeaders: {name,value,matched:boolean}[] }`
- Import UI: `{ open, pasteText, collisions: string[], applyToAll: boolean }`
- **Persistence:** profiles + masterEnabled in `chrome.storage.sync` (or `.local`); the log
  is **session-only** and not persisted. Sync dynamic `declarativeNetRequest` rules whenever
  profiles/toggles change.

## Design Tokens
Colors (exact):
- `--bg: #0b0b0c`
- `--surface: #141417`
- `--surface-2: #0f0f12` (cards inside surfaces)
- `--border: #2a2a2e`
- `--border-soft: #17171b` / `#22222a` / `#1c1c21` (dividers, card borders)
- `--text: #e7e7e9`
- `--muted: #8a8a90` (secondary: `#6a6a70`, faint: `#5a5a62`)
- `--accent: #6ea8fe`  · accent-tint bg `#1a2537` · accent border `#33465f`
- `--success: #5fd08a`
- `--danger: #f2777a`
- Chip backgrounds use ~10–12% alpha of the hue with ~28–30% alpha borders.

Typography:
- Sans (UI): `system-ui, -apple-system, "Segoe UI", sans-serif`
- Mono (values, URLs, hints, JSON): `ui-monospace, "SF Mono", Menlo, monospace`
- Sizes: page/app title 15px·650 · popup title 13.5px·650 · body 12–13px · labels 10–10.5px
  uppercase muted (letter-spacing ~.03–.12em) · chips 9.5–10px · monospace values 11–11.5px.
- Developer-tool density: compact paddings, 28–34px control heights.

Radius: controls/inputs 7–8px · cards 9px · panels/windows 12px · pills/toggles 999px.

Shadows: floating surfaces `0 24px 60px -12px rgba(0,0,0,.8)`; dropdowns
`0 14px 30px -8px rgba(0,0,0,.7)`.

Control sizes: master toggle 46×26 (knob 20) · list toggle 34×20 (knob 16) · profile-enabled
toggle 40×23 (knob 17) · checkbox 16×16 · inline buttons 26–32px.

## Assets
- **App icon:** drawn in CSS (rounded square + 3 stacked bars, top bar accent). Replace with
  the project's real icon set (`icons/16,32,48,128`). No external image assets are used.
- **Browser chrome** in the composite is decorative (for the store screenshot) and is **not**
  part of the extension UI — do not implement it.
- No icon font is used; glyphs are Unicode (gear ⚙, checkmarks, arrows). Swap for the repo's
  icon library if it has one.

## Files
- `Header Handler Mock.dc.html` — the high-fidelity composite of all three surfaces. Open it
  in a browser to inspect exact spacing, colors, and states (Options shows an expanded
  override-matcher with a regex error, and a JSON value rule; the side panel shows an
  expanded entry with highlighted matched headers).
