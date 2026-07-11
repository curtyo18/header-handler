import { useState } from "preact/hooks";
import type { HeaderRule, Matcher } from "../../src/types";
import { byteLength, formatJson, isLikelyJson, minifyJson, validateJson } from "../../src/lib/json-value";
import { MatcherControl, regexError } from "./MatcherControl";
import { highlightJson } from "./jsonHighlight";

const JSON_WARN_BYTES = 8192 * 0.8;

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

function ValueEditor({ rule, onChange }: { rule: HeaderRule; onChange: (value: string) => void }) {
  const value = rule.value ?? "";
  const [draft, setDraft] = useState(value);
  const looksJson = isLikelyJson(draft) || (draft.trim().startsWith("{") || draft.trim().startsWith("["));
  const jsonCheck = looksJson ? validateJson(draft) : null;
  const bytes = byteLength(draft);

  function commit(next: string) {
    if (jsonCheck?.valid) {
      onChange(minifyJson(next));
    } else if (!looksJson) {
      onChange(next);
    }
    // invalid JSON: don't commit, keep draft so the user can fix it
  }

  if (!looksJson) {
    return (
      <textarea
        class="input input-mono value-input"
        value={draft}
        placeholder="header value"
        onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        onBlur={() => commit(draft)}
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
            commit(pretty);
          }}
        >
          Format
        </button>
      </div>
      <div class="json-body">
        <textarea
          class="json-body-input"
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          onBlur={() => commit(draft)}
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
}: {
  rule: HeaderRule;
  onChange: (next: HeaderRule) => void;
  onDelete: () => void;
}) {
  const [overrideOpen, setOverrideOpen] = useState(!!rule.matcher);

  function toggleOverride() {
    if (overrideOpen) {
      setOverrideOpen(false);
      if (rule.matcher && rule.matcher.mode === "contains" && rule.matcher.value === "") {
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
          <ValueEditor rule={rule} onChange={(value) => onChange({ ...rule, value })} />
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
