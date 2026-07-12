import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { HeaderRule, Matcher } from "../../src/types";
import { byteLength, formatJson, isLikelyJson, minifyJson, validateJson } from "../../src/lib/json-value";
import { MatcherControl, regexError } from "./MatcherControl";
import { highlightJson } from "./jsonHighlight";

const JSON_WARN_BYTES = 8192 * 0.8;
const COMMIT_DEBOUNCE_MS = 400;

const looksLikeJson = (s: string) =>
  isLikelyJson(s) || s.trim().startsWith("{") || s.trim().startsWith("[");

// Rule is "invalid" (blocks commit) when its override matcher regex is broken,
// or its value looks like JSON but fails to parse.
export function ruleHasBlockingError(rule: HeaderRule): boolean {
  if (rule.matcher && regexError(rule.matcher.mode, rule.matcher.value)) return true;
  const v = (rule.value ?? "").trim();
  if (rule.op === "set" && (v.startsWith("{") || v.startsWith("["))) {
    if (!validateJson(v).valid) return true;
  }
  return false;
}

function ValueEditor({
  rule,
  onChange,
  onEditing,
}: {
  rule: HeaderRule;
  onChange: (value: string) => void;
  onEditing?: () => void;
}) {
  const value = rule.value ?? "";
  const [draft, setDraft] = useState(value);
  const looksJson = looksLikeJson(draft);
  const jsonCheck = looksJson ? validateJson(draft) : null;
  const bytes = byteLength(draft);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const debounceRef = useRef<number>();

  // Plain and JSON modes render different textarea nodes, so the moment a
  // keystroke flips looksJson the mounted textarea is swapped out and loses
  // focus mid-edit. Re-focus and restore the caret on the newly-mounted one.
  useLayoutEffect(() => {
    if (pendingCaret.current != null && taRef.current) {
      const pos = pendingCaret.current;
      pendingCaret.current = null;
      taRef.current.focus();
      taRef.current.setSelectionRange(pos, pos);
    }
  });

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function commit(next: string) {
    // Recompute from `next` rather than closing over render state: a debounced
    // commit fires after later keystrokes, so the closure would be stale.
    if (looksLikeJson(next)) {
      if (validateJson(next).valid) onChange(minifyJson(next));
      // invalid JSON: don't commit, keep draft so the user can fix it
    } else {
      onChange(next);
    }
  }

  function handleInput(e: Event) {
    const ta = e.target as HTMLTextAreaElement;
    const next = ta.value;
    const nextLooksJson = looksLikeJson(next);
    if (nextLooksJson !== looksJson) pendingCaret.current = ta.selectionStart;
    setDraft(next);
    // Live-save shortly after typing stops (matching the immediate-save fields).
    // Only signal for content that will actually commit, so the status pill and
    // its "Saving…" state stay honest while JSON is mid-edit / invalid.
    if (!nextLooksJson || validateJson(next).valid) {
      onEditing?.();
      clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => commit(next), COMMIT_DEBOUNCE_MS);
    }
  }

  function flush() {
    clearTimeout(debounceRef.current);
    commit(draft);
  }

  if (!looksJson) {
    return (
      <textarea
        ref={taRef}
        class="input input-mono value-input"
        value={draft}
        placeholder="header value"
        onInput={handleInput}
        onBlur={flush}
      />
    );
  }

  const bytesClass = bytes >= 8192 ? "danger" : bytes >= JSON_WARN_BYTES ? "amber" : "muted";

  return (
    <div class="json-editor">
      <div class="json-toolbar">
        <span class="json-badge">{"{ }"} JSON</span>
        <button
          type="button"
          class="btn-format"
          onClick={() => {
            const pretty = formatJson(draft);
            setDraft(pretty);
            onEditing?.();
            commit(pretty);
          }}
        >
          Format
        </button>
      </div>
      <div class="json-body">
        <textarea
          ref={taRef}
          class="json-body-input"
          value={draft}
          onInput={handleInput}
          onBlur={flush}
          spellcheck={false}
        />
        <div class="json-body-highlight" aria-hidden="true">
          {highlightJson(draft)}
          {"\n"}
        </div>
      </div>
      <div class={`json-footer ${jsonCheck?.valid ? "" : "invalid"}`}>
        {jsonCheck?.valid ? (
          <>
            <span class="ok">✓ valid JSON</span>
            <span class="dot">·</span>
            <span class={bytesClass}>{bytes} bytes</span>
            <span class="dot">·</span>
            <span class="muted">sent minified → one line</span>
          </>
        ) : (
          <span class="danger">⚠ Invalid JSON{jsonCheck?.error ? `: ${jsonCheck.error}` : ""}</span>
        )}
      </div>
    </div>
  );
}

export function HeaderRow({
  rule,
  onChange,
  onDelete,
  onEditing,
}: {
  rule: HeaderRule;
  onChange: (next: HeaderRule) => void;
  onDelete: () => void;
  onEditing?: () => void;
}) {
  const [overrideOpen, setOverrideOpen] = useState(!!rule.matcher);

  function toggleOverride() {
    if (overrideOpen) {
      setOverrideOpen(false);
      if (rule.matcher && rule.matcher.value === "") {
        const { matcher: _drop, ...rest } = rule;
        onChange(rest);
      }
    } else {
      setOverrideOpen(true);
      if (!rule.matcher) onChange({ ...rule, matcher: { mode: "contains", value: "" } });
    }
  }

  function removeOverride() {
    setOverrideOpen(false);
    const { matcher: _drop, ...rest } = rule;
    onChange(rest);
  }

  return (
    <div class="rule-card">
      <div class="rule-row">
        <input
          type="checkbox"
          class="checkbox"
          checked={rule.enabled}
          onChange={(e) => onChange({ ...rule, enabled: (e.target as HTMLInputElement).checked })}
        />
        <select
          class={`select select-op ${rule.op === "remove" ? "op-danger" : ""}`}
          value={rule.op}
          onChange={(e) => onChange({ ...rule, op: (e.target as HTMLSelectElement).value as HeaderRule["op"] })}
        >
          <option value="set">Set</option>
          <option value="remove">Remove</option>
        </select>
        <input
          type="text"
          class="input input-mono header-name-input"
          value={rule.name}
          placeholder="Header-Name"
          onInput={(e) => onChange({ ...rule, name: (e.target as HTMLInputElement).value })}
        />
        {rule.op === "remove" ? (
          <div class="value-input value-disabled">no value for Remove</div>
        ) : (
          <ValueEditor rule={rule} onChange={(value) => onChange({ ...rule, value })} onEditing={onEditing} />
        )}
        <div class="row-actions">
          <button
            type="button"
            title="Override match"
            class={`btn-icon-sm ${overrideOpen ? "active" : ""}`}
            onClick={toggleOverride}
          >
            ▾
          </button>
          <button type="button" title="Delete" class="btn-icon-sm btn-danger" onClick={onDelete}>
            ×
          </button>
        </div>
      </div>
      {overrideOpen && rule.matcher && (
        <div class="override-panel">
          <div class="label-sm">OVERRIDE MATCH FOR THIS RULE</div>
          <MatcherControl matcher={rule.matcher} onChange={(matcher: Matcher) => onChange({ ...rule, matcher })} compact />
          <button type="button" class="link-remove" onClick={removeOverride}>
            Remove override
          </button>
        </div>
      )}
    </div>
  );
}
