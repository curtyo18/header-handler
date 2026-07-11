// Lightweight JSON pretty-print syntax highlighter: keys accent, string values success,
// numbers/other text, punctuation muted. Input is assumed already-valid JSON text.
import type { ComponentChildren } from "preact";

const TOKEN_RE = /("(?:\\.|[^"\\])*")(\s*:)?|([{}[\],])|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)/g;

export function highlightJson(text: string) {
  const nodes: ComponentChildren[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [full, str, colon, punct, num, lit] = match;
    if (str !== undefined) {
      const cls = colon !== undefined ? "json-key" : "json-string";
      nodes.push(
        <span class={cls} key={key++}>
          {str}
        </span>,
      );
      if (colon) nodes.push(<span class="json-punct" key={key++}>{colon}</span>);
    } else if (punct !== undefined) {
      nodes.push(
        <span class="json-punct" key={key++}>
          {punct}
        </span>,
      );
    } else if (num !== undefined || lit !== undefined) {
      nodes.push(
        <span class="json-text" key={key++}>
          {full}
        </span>,
      );
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
