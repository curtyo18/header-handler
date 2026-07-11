// Helpers for the "edit pretty / store minified" header-value UX (see design handoff).
// HTTP header values cannot contain literal newlines, so JSON values are pretty-printed
// for editing but minified to a single line before being stored/sent.

export function byteLength(v: string): number {
  return new TextEncoder().encode(v).length;
}

export function validateJson(v: string): { valid: boolean; error?: string } {
  const t = v.trim();
  if (t === "") return { valid: false };
  try {
    JSON.parse(t);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}

// Cheap gate for whether to show the JSON badge/toolbar: looks structural AND parses.
export function isLikelyJson(v: string): boolean {
  const t = v.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  return validateJson(t).valid;
}

export function formatJson(v: string): string {
  const t = v.trim();
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return v; // leave invalid input untouched; the UI surfaces the error separately
  }
}

export function minifyJson(v: string): string {
  const t = v.trim();
  try {
    return JSON.stringify(JSON.parse(t));
  } catch {
    return v;
  }
}
