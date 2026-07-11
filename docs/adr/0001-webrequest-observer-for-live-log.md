# 0001. webRequest observer for the live log

Date: 2026-07-11
Status: accepted

## Context

The extension modifies headers with `declarativeNetRequest` (DNR), the only MV3-supported mechanism. DNR is deliberately opaque: a **published** extension cannot learn which rule fired on which request. The one API that reveals it, `declarativeNetRequest.onRuleMatchedDebug`, fires **only for unpacked/dev extensions**, so it is unavailable in the Web Store build — yet a "requests I touched" live log is a headline feature.

The alternatives were: (a) ship a dev-only accurate log that is empty in production; (b) show no live log, only a static rule inspector; (c) add non-blocking `webRequest` observation and re-run our own matcher logic to reconstruct which rules *should* have applied.

## Decision

Add read-only (non-blocking) `webRequest` with `extraHeaders` and reconstruct the log by evaluating the active config's matchers against each observed request, using the **same matcher-evaluation module** that drives rule compilation. The log is session-only and held in memory.

## Consequences

- Commits the extension to the `webRequest` permission and `<all_urls>` host access, and to disclosing in the privacy policy that all request headers on matched requests are read into memory for the session.
- The log is a **reconstruction**, not proof DNR applied the change; compile logic and log logic must share one matcher module or they will drift and the log will lie.
- Rules out claiming per-request ground truth in production; `onRuleMatchedDebug` may later augment (not replace) this when loaded unpacked.
- Reversing this (dropping `webRequest`) later would remove the feature and trigger a Web Store re-review of reduced permissions — cheap to remove, but the user-facing feature is then gone.
