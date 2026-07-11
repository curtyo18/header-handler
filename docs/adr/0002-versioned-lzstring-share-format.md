# 0002. Versioned lz-string share format

Date: 2026-07-11
Status: accepted

## Context

Profiles are shared as import/export strings. Once users paste these strings into chats, gists, and docs, the wire format is effectively permanent — a later change that can't decode old strings breaks sharing silently. We needed a compression choice and a forward-compatibility strategy decided up front, because it is the one part of the system that is genuinely hard to reverse after release.

Compression options were `lz-string` (purpose-built for compressing JSON to URL-safe strings, tiny, one call each way) versus `pako` gzip + hand-rolled base64url (better ratio on large blobs, heavier dependency, more moving parts).

## Decision

Use `lz-string` (`compressToEncodedURIComponent` / `decompressFromEncodedURIComponent`), and prefix every string with a fixed, human-visible header: `HH` + a one-character **format version** + a one-character **kind** (`p` = single profile, `g` = global). Local `id`s are stripped on export and regenerated on import.

## Consequences

- Commits to a stable, self-describing prefix: any future format change bumps the version character and old strings remain decodable by keeping the old path.
- Chooses smaller dependency footprint and simpler code over the marginally better compression ratio of gzip; configs are small enough that ratio is not the constraint.
- The `HH…` prefix makes strings recognizable and lets Import reject foreign/corrupt input before attempting decompression.
- Stripping ids means imports never collide on internal ids and are portable, at the cost of not preserving id identity across machines (acceptable — ids are local-only).
