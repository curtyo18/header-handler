import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { configStore } from "../../src/lib/storage";
import type { Config, Profile } from "../../src/types";

function ruleCountLabel(p: Profile): string {
  const count = p.rules.filter((r) => r.enabled).length;
  const noun = count === 1 ? "rule" : "rules";
  return p.enabled ? `${count} ${noun} enabled` : `${count} ${noun} · off`;
}

function AppIcon({ size }: { size: number }) {
  return (
    <div class="app-icon" style={{ width: size, height: size }}>
      <span class="bar bar-accent" />
      <span class="bar" />
      <span class="bar" />
    </div>
  );
}

function Switch({ on, onClick, size }: { on: boolean; onClick: () => void; size: "master" | "list" }) {
  return (
    <button
      type="button"
      class={`switch switch-${size} ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      onClick={onClick}
    >
      <span class="knob" />
    </button>
  );
}

function App() {
  const [cfg, setCfg] = useState<Config | null>(null);
  // Resolve the window id at mount so opening the side panel needs no preceding
  // await — chrome.sidePanel.open() must be the first await in the click handler
  // or Chrome's user-gesture check can reject it (issue #7).
  const [windowId, setWindowId] = useState<number | null>(null);
  const [panelError, setPanelError] = useState(false);

  useEffect(() => {
    configStore.getValue().then(setCfg);
    return configStore.watch(setCfg);
  }, []);

  useEffect(() => {
    chrome.windows.getCurrent().then((w) => setWindowId(w.id ?? null)).catch(() => {});
  }, []);

  async function openLiveLog() {
    setPanelError(false);
    try {
      // windowId is already resolved (mount), so open() is the first await here.
      const wid = windowId ?? (await chrome.windows.getCurrent()).id;
      if (wid == null) throw new Error("no window id");
      await chrome.sidePanel.open({ windowId: wid });
      window.close();
    } catch {
      // Don't fail silently — the panel didn't open; tell the user.
      setPanelError(true);
    }
  }

  if (!cfg) return null;

  // Revert the optimistic toggle if the write fails (e.g. over the 8 KB sync
  // quota) so the switch can't silently disagree with what's stored (issue #5).
  function toggleMaster() {
    setCfg((c) => {
      if (!c) return c;
      const next = { ...c, masterEnabled: !c.masterEnabled };
      configStore.setValue(next).catch(() => setCfg(c));
      return next;
    });
  }

  function toggleProfile(id: string) {
    setCfg((c) => {
      if (!c) return c;
      const next = {
        ...c,
        profiles: c.profiles.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
      };
      configStore.setValue(next).catch(() => setCfg(c));
      return next;
    });
  }

  return (
    <div class="popup">
      <header class="popup-header">
        <div class="popup-title-group">
          <AppIcon size={26} />
          <div>
            <div class="popup-title">Header Handler</div>
            <div class="popup-subtitle">Modify request headers</div>
          </div>
        </div>
        <Switch on={cfg.masterEnabled} onClick={toggleMaster} size="master" />
      </header>

      {cfg.profiles.length === 0 ? (
        <div class="empty-state">
          <div class="empty-line">No profiles yet</div>
          <button type="button" class="btn btn-accent" onClick={() => chrome.runtime.openOptionsPage()}>
            Create a profile
          </button>
        </div>
      ) : (
        <div class="profile-list">
          {cfg.profiles.map((p) => (
            <div class={`profile-row ${p.enabled ? "" : "dimmed"}`} key={p.id}>
              <div>
                <div class="profile-name">{p.name}</div>
                <div class="profile-count">{ruleCountLabel(p)}</div>
              </div>
              <Switch on={p.enabled} onClick={() => toggleProfile(p.id)} size="list" />
            </div>
          ))}
        </div>
      )}

      <footer class="popup-footer">
        <button
          type="button"
          class="btn btn-accent btn-full"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          <span class="icon">⚙</span> Manage profiles & rules
        </button>
        <button
          type="button"
          class="btn btn-icon"
          title="Open live log"
          aria-label="Open live log"
          onClick={openLiveLog}
        >
          📋
        </button>
      </footer>
      {panelError && (
        <div class="panel-error" role="alert">
          Couldn't open the live log. Try the extension's side-panel icon in the toolbar.
        </div>
      )}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
