// Chrome's declarativeNetRequest only supports the "append" header operation
// for this fixed set of request headers, per Chrome's own docs
// (https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest):
// "The append operation is only supported for the following request headers...
// This allowlist is case sensitive." Chrome's docs don't specify per-header
// separator characters beyond "the browser will use the appropriate separator
// where possible" — don't claim more specificity than that anywhere this is used.
export const APPENDABLE_HEADERS = new Set([
  "accept", "accept-encoding", "accept-language", "access-control-request-headers",
  "cache-control", "connection", "content-language", "cookie", "forwarded",
  "if-match", "if-none-match", "keep-alive", "range", "te", "trailer",
  "transfer-encoding", "upgrade", "user-agent", "via", "want-digest", "x-forwarded-for",
]);

// Chrome's allowlist match is case-sensitive on lowercase forms, but this
// extension always lowercases header names before sending them to DNR
// (see compile.ts's rule.name.toLowerCase()), so comparing case-insensitively
// here is equivalent to what actually reaches Chrome.
export function isAppendableHeader(name: string): boolean {
  return APPENDABLE_HEADERS.has(name.trim().toLowerCase());
}
