import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { configStore } from "../../src/lib/storage";
import type { Config, HeaderRule, Profile } from "../../src/types";
import { encodeShare } from "../../src/lib/share";
import { MatcherControl } from "./MatcherControl";
import { HeaderRow } from "./HeaderRow";
import { ImportModal } from "./ImportModal";

function AppIcon() {
  return (
    <div class="app-icon">
      <span class="bar bar-accent" />
      <span class="bar" />
      <span class="bar" />
    </div>
  );
}

function newProfile(): Profile {
  return { id: crypto.randomUUID(), name: "New profile", enabled: true, matcher: { mode: "contains", value: "" }, rules: [] };
}

function newRule(): HeaderRule {
  return { id: crypto.randomUUID(), enabled: true, op: "set", name: "", value: "" };
}

function App() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    configStore.getValue().then((c) => {
      setCfg(c);
      if (c.profiles.length > 0) setSelectedId(c.profiles[0].id);
    });
    return configStore.watch((c) => setCfg(c));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  if (!cfg) return null;

  const selected = cfg.profiles.find((p) => p.id === selectedId) ?? null;

  function update(next: Config) {
    setCfg(next);
    configStore.setValue(next);
  }

  function updateSelected(patch: Partial<Profile>) {
    if (!selected) return;
    update({
      ...cfg!,
      profiles: cfg!.profiles.map((p) => (p.id === selected.id ? { ...p, ...patch } : p)),
    });
  }

  function addProfile() {
    const p = newProfile();
    update({ ...cfg!, profiles: [...cfg!.profiles, p] });
    setSelectedId(p.id);
  }

  function updateRule(ruleId: string, next: HeaderRule) {
    if (!selected) return;
    updateSelected({ rules: selected.rules.map((r) => (r.id === ruleId ? next : r)) });
  }

  function deleteRule(ruleId: string) {
    if (!selected) return;
    updateSelected({ rules: selected.rules.filter((r) => r.id !== ruleId) });
  }

  function addRule() {
    if (!selected) return;
    updateSelected({ rules: [...selected.rules, newRule()] });
  }

  async function copyToClipboard(s: string) {
    await navigator.clipboard.writeText(s);
    setToast("Copied to clipboard");
  }

  function exportThisProfile() {
    if (!selected) return;
    setExportOpen(false);
    copyToClipboard(encodeShare({ kind: "p", profile: selected }));
  }

  function exportAllProfiles() {
    setExportOpen(false);
    copyToClipboard(encodeShare({ kind: "g", config: cfg! }));
  }

  return (
    <div class="options-page">
      <header class="top-bar">
        <div class="top-bar-left">
          <AppIcon />
          <div class="wordmark">Header Handler</div>
        </div>
        <div class="top-bar-right">
          <button type="button" class="btn" onClick={() => setImportOpen(true)}>
            Import
          </button>
          <div class="export-wrap">
            <button type="button" class="btn btn-outline-accent" onClick={() => setExportOpen((v) => !v)}>
              Export <span class="caret">▾</span>
            </button>
            {exportOpen && (
              <div class="export-menu">
                <div class="export-menu-item" onClick={exportThisProfile}>
                  Export this profile
                </div>
                <div class="export-menu-item" onClick={exportAllProfiles}>
                  Export all profiles
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div class="body">
        <div class="profiles-col">
          <div class="label-uppercase">Profiles</div>
          {cfg.profiles.map((p) => (
            <div
              class={`profile-item ${p.id === selectedId ? "selected" : ""}`}
              key={p.id}
              onClick={() => setSelectedId(p.id)}
            >
              <span class={`status-dot ${p.enabled ? "on" : "off"}`} />
              {p.name}
            </div>
          ))}
          <button type="button" class="btn-dashed" onClick={addProfile}>
            ＋ New profile
          </button>
        </div>

        <div class="editor-col">
          {!selected ? (
            <div class="empty-editor">Select or create a profile to begin.</div>
          ) : (
            <>
              <div class="field-row">
                <div class="field-grow">
                  <label class="label-sm">PROFILE NAME</label>
                  <input
                    type="text"
                    class="input"
                    value={selected.name}
                    onInput={(e) => updateSelected({ name: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="enabled-stack">
                  <label class="label-sm">Enabled</label>
                  <button
                    type="button"
                    class={`switch switch-profile ${selected.enabled ? "on" : ""}`}
                    role="switch"
                    aria-checked={selected.enabled}
                    onClick={() => updateSelected({ enabled: !selected.enabled })}
                  >
                    <span class="knob" />
                  </button>
                </div>
              </div>

              <div>
                <label class="label-sm">URL MATCHER</label>
                <MatcherControl matcher={selected.matcher} onChange={(matcher) => updateSelected({ matcher })} />
              </div>

              <div>
                <label class="label-sm">HEADER RULES</label>
                <div class="rules-col-header">
                  <span class="col-check" />
                  <span class="col-op">Op</span>
                  <span class="col-name">Header</span>
                  <span class="col-value">Value</span>
                  <span class="col-actions" />
                </div>
                {selected.rules.map((r) => (
                  <HeaderRow
                    rule={r}
                    key={r.id}
                    onChange={(next) => updateRule(r.id, next)}
                    onDelete={() => deleteRule(r.id)}
                  />
                ))}
                <button type="button" class="btn-dashed btn-dashed-block" onClick={addRule}>
                  ＋ Add header
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {importOpen && (
        <ImportModal config={cfg} onClose={() => setImportOpen(false)} onApply={(next) => update(next)} />
      )}

      {toast && <div class="toast">{toast}</div>}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
