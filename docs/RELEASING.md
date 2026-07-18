# Releasing

**Releases are automatic. Every merge to `main` cuts a release.**
[`.github/workflows/auto-release.yml`](../.github/workflows/auto-release.yml) runs on
every push to `main`, bumps the **patch** version, builds, tags `v<version>`, and
publishes a GitHub release with the Web Store zip and an unpacked-install zip
attached.

> For agents and humans: **do not** hand-cut a normal release — just merge to
> `main` and CI ships it. There is no manual step to remember or forget. Bumping
> the version yourself for a normal change is wrong; the workflow does it.

## Normal release (the only path you usually need)

1. Merge a PR (or push) to `main`.
2. That's it. `auto-release.yml` bumps the patch, tags, and publishes. Watch it:
   `gh run list --workflow=auto-release.yml` → `gh release view v<version>`.

The bump commit it makes back to `main` carries `[skip ci]`, so it doesn't
re-trigger the workflow (and `GITHUB_TOKEN` pushes don't trigger workflows either
— two independent loop guards). Runs are serialized by a `concurrency` group so
two quick merges can't collide on a version.

> **Footgun — keep CI-skip tokens out of commit and PR messages.** GitHub scans
> the *entire* merge-commit message and silently skips **all** workflows if it
> finds a skip token (the bracketed `skip ci` / `ci skip` / `no ci` /
> `skip actions` / `actions skip` forms). A PR that merely *describes* the
> mechanism in its body — or a squash that inherits such a body — will not release.
> Mention the token only in files (like this one), never in a commit/PR message.
> This is a GitHub-platform behaviour; a workflow cannot run on a commit GitHub
> chose to skip.

## Minor / major bump (rare, deliberate)

Auto-release only ever bumps the **patch**. To jump the minor or major:

1. In a commit **with `[skip ci]` in the message** (so auto-release skips it), set
   `package.json` to the target version — e.g. `1.4.0` — and push to `main`.
2. Push a matching tag manually: `git tag -a v1.4.0 -m "Release v1.4.0" && git push origin v1.4.0`.
   The tag-driven [`release.yml`](../.github/workflows/release.yml) builds and
   publishes it (it hard-fails if the tag ≠ `v<package.json version>`).
3. Subsequent merges auto-patch from there (`v1.4.1`, `v1.4.2`, …).

`release.yml` is the manual escape hatch — use it for a minor/major, or to
re-cut/repair a specific version. It is idempotent (re-pushing a tag re-uploads
assets). `package.json` is the single source of truth for the version — WXT
derives the extension `manifest.json` version from it.

## What is NOT automated

- **Chrome Web Store upload.** Both workflows publish a *GitHub* release only.
  Shipping to users is still a manual upload of the `…-chrome.zip` to the CWS
  dashboard, followed by CWS review.

## Version history

Tags: `v0.1.0` … `v0.1.4`, `v1.0.0` … `v1.0.3`, `v1.1.0`, `v1.2.0`, `v1.3.0`, …
(from `v1.3.x` on, patch versions are cut automatically per merge).

- `v1.3.0` — chunked `chrome.storage.sync` (raises the ~8 KB single-item config
  ceiling to ~84 KB by splitting across items behind a manifest; see ADR-0005/0006)
  + ModHeader converter regex fix (strip redundant `.*` so Chrome's RE2 engine
  doesn't reject imported matchers as "too large").
