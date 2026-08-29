# 0008. All-URLs matcher encoded as regex `.*`, not a new MatchMode

Date: 2026-08-29
Status: accepted

## Context

Issue #38 asks for a first-class "all URLs" matcher so a newly created profile
works with zero configuration. Today a new profile is created with
`{ mode: "contains", value: "" }`, and `compileRules` skips every rule in it —
the extension looks broken until the user discovers the matcher field.

The obvious implementation is a seventh `MatchMode` variant, `"all"`. That runs
straight into two existing decisions:

- **ADR-0002** — the matcher shape is part of the share-string wire format.
- **ADR-0006** — mixed-version coexistence is last-write-wins with no old-client
  guards: an older installation reads the same synced config.

`isMatchMode` is a hard allowlist (`src/lib/matcher.ts`), deliberately so — an
unrecognized mode must never fall through to a filter-less DNR condition, which
DNR treats as match-all. That guard means an old client receiving a `"all"`
matcher — by sync or by pasted share string — rejects it and the profile
silently matches nothing. The user sees a profile that works on one machine and
does nothing on another, with no error anywhere.

There is also a precedent already in the tree: the ModHeader converter has
encoded "no URL filter" as `{ mode: "regex", value: ".*" }` since it shipped
(`src/lib/modheader.ts`). A new `"all"` mode would create a second encoding for
a concept that already has one.

## Decision

All-URLs is **not** a new mode. It is the existing Custom regex mode with the
exact value `.*`, recognized by `isAllUrls(m)` in `src/lib/matcher.ts` and
surfaced in the editor as its own "All URLs" choice in the mode select.

`matcherToDnrCondition` special-cases it to `{ urlFilter: "*" }` rather than
`{ regexFilter: ".*" }`: every new profile now runs against every request, so
the default path must be a plain filter match, not an RE2 evaluation.

Existing profiles carrying an empty matcher value are **not** migrated. They
match nothing today; silently activating them on update would send headers the
user never consented to send.

## Consequences

- Zero wire-format change. Old clients compile an all-URLs profile correctly
  instead of dropping it, so ADR-0006's last-write-wins model stays safe and the
  share version stays at `1`.
- One encoding for one concept — converted ModHeader profiles and profiles
  created in the editor produce byte-identical matchers, and both now compile to
  the cheaper `urlFilter` form.
- The mode select's displayed value is no longer a pure function of
  `matcher.mode`: it is `isAllUrls(m) ? "all" : m.mode`. A user who picks Custom
  regex and types `.*` sees the control flip to All URLs. This is accepted — the
  label is telling the truth about what the matcher does.
- It rules out ever giving all-URLs its own semantics distinct from the regex
  `.*` behaviour (for example, matching non-HTTP schemes differently) without
  revisiting the encoding.
