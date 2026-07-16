# 0004. ModHeader converter as a committed Vite build under /docs

Date: 2026-07-16
Status: accepted

## Context

The repo needs a public GitHub Pages page that converts a ModHeader export into a
Header Handler share string. Two constraints shape the hosting choice:

- The share format is effectively permanent (ADR-0002); a converter that
  hand-reproduces it can silently drift from `src/lib/share.ts` and emit strings
  the extension can't decode. Reusing the real `encodeShare` eliminates that risk
  but requires a build step (it imports `lz-string`).
- The store submission's privacy policy is already served from the `main`
  branch `/docs` folder (`docs/privacy.html`). Any change to how Pages is hosted
  risks breaking that live URL, which the Chrome Web Store listing depends on.

Options: (a) a separate Vite build rooted at `pages/convert/`, output committed to
`docs/convert/`, served by the existing `/docs` Pages source; or (b) migrate Pages
to a GitHub Actions build-and-deploy artifact.

## Decision

Build the converter with a standalone Vite config (`vite.pages.config.ts`) that
imports the real `src/lib/share.ts`, output to `docs/convert/`, and **commit the
built output**. Keep Pages hosted from `main` `/docs` unchanged.

## Consequences

- Zero format drift: the page can only emit what the extension decodes, because
  it links the same `encodeShare`.
- The live `privacy.html` URL and its hosting model are untouched — the converter
  is additive under `docs/convert/`.
- Cost: a minified bundle lives in git, and the build must be re-run and
  re-committed whenever the share format changes. Accepted as a small, contained
  cost for one tiny page versus migrating the whole Pages hosting model.
- Rules out (for now) a CI-built Pages artifact; revisiting that later would mean
  re-homing `privacy.html` into the same pipeline.
