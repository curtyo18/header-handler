# Releasing

Releases are **tag-driven**. Pushing a `v*` tag triggers
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which
verifies the tag matches `package.json`, builds, zips, and publishes a GitHub
release with the Web Store zip and an unpacked-install zip attached.

## Steps

1. **Bump the version** in `package.json` (this is the single source of truth —
   WXT derives the extension `manifest.json` version from it, and CI hard-fails
   if the tag doesn't equal `v<package.json version>`). Use semver: patch for
   fixes/UI tweaks, minor for features, major for breaking changes.
2. **Commit** the change(s) being released, including the version bump.
3. **Tag** the release commit: `git tag v<version>` (e.g. `git tag v1.0.1`).
4. **Push** the branch and the tag: `git push && git push origin v<version>`.
5. **Watch** the `Release` workflow: `gh run watch` (or
   `gh run list --workflow=release.yml`). On success, confirm the release:
   `gh release view v<version>`.

The publish step is idempotent — re-pushing the same tag re-uploads assets
rather than erroring.

## Who runs the ship step

The mechanical **ship** step (tag → push → monitor CI → confirm release) is
delegated to a **Sonnet** subagent. Preparation that needs judgment — the code
change, the version-bump decision, the commit message, and any docs — stays on
the primary (Opus) agent. Sonnet just executes the well-scoped, deterministic
release once the commits are in place.

## Version history

Tags: `v0.1.0` … `v0.1.4`, `v1.0.0` … `v1.0.3`, `v1.1.0`, `v1.2.0`, `v1.3.0`, …

- `v1.3.0` — chunked `chrome.storage.sync` (raises the ~8 KB single-item config
  ceiling to ~84 KB by splitting across items behind a manifest; see ADR-0005/0006)
  + ModHeader converter regex fix (strip redundant `.*` so Chrome's RE2 engine
  doesn't reject imported matchers as "too large").
