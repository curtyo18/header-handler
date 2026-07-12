import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { configStore, logStore, type LogEntry } from "../../src/lib/storage";
import type { Config, HeaderRule, Profile } from "../../src/types";

const METHOD_CLASS: Record<string, string> = {
  GET: "method-success",
  POST: "method-accent",
  PUT: "method-amber",
  PATCH: "method-amber",
  DELETE: "method-danger",
};

function methodClass(method: string): string {
  return METHOD_CLASS[method] ?? "method-accent";
}

function splitUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: u.pathname + u.search };
  } catch {
    return { host: url, path: "" };
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

interface MatchedChip {
  key: string;
  label: string;
}

interface ResolvedMatch {
  profile: Profile;
  rule: HeaderRule;
}

function resolveMatches(cfg: Config | null, matchedRuleIds: string[]): ResolvedMatch[] {
  if (!cfg) return [];
  const out: ResolvedMatch[] = [];
  for (const id of matchedRuleIds) {
    const [profileId, ruleId] = id.split(":");
    const profile = cfg.profiles.find((p) => p.id === profileId);
    const rule = profile?.rules.find((r) => r.id === ruleId);
    if (profile && rule) out.push({ profile, rule });
  }
  return out;
}

function matchChips(matches: ResolvedMatch[]): MatchedChip[] {
  return matches.map(({ profile, rule }) => ({
    key: `${profile.id}:${rule.id}`,
    label: `${profile.name} › ${rule.op === "set" ? "+" : "−"}${rule.name}`,
  }));
}

function LogCard({ entry, cfg }: { entry: LogEntry; cfg: Config | null }) {
  const [expanded, setExpanded] = useState(false);
  const { host, path } = splitUrl(entry.url);
  const matches = resolveMatches(cfg, entry.matchedRuleIds);
  const chips = matchChips(matches);
  const matchedSetNames = new Set(
    matches.filter((m) => m.rule.op === "set").map((m) => m.rule.name.toLowerCase()),
  );

  return (
    <div class="log-card">
      <div
        class="log-line1"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <span class={`method-chip ${methodClass(entry.method)}`}>{entry.method}</span>
        <span class="log-url">
          <span class="log-host">{host}</span>
          <span class="log-path">{path}</span>
        </span>
        <span class="log-time">{formatTime(entry.ts)}</span>
      </div>
      {chips.length > 0 && (
        <div class="log-chips">
          {chips.map((c) => (
            <span class="rule-chip" key={c.key}>
              {c.label}
            </span>
          ))}
        </div>
      )}
      {expanded && (
        <div class="log-headers">
          {entry.requestHeaders.map((h, i) => {
            const matched = matchedSetNames.has(h.name.toLowerCase());
            return (
              <div class={`log-header-row ${matched ? "matched" : ""}`} key={i}>
                <span class="log-header-name">{h.name}:</span> {h.value}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function App() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [log, setLog] = useState<LogEntry[] | null>(null);

  useEffect(() => {
    configStore.getValue().then(setCfg);
    const unwatchCfg = configStore.watch(setCfg);
    logStore.getValue().then(setLog);
    const unwatchLog = logStore.watch(setLog);
    return () => {
      unwatchCfg();
      unwatchLog();
    };
  }, []);

  return (
    <div class="sidepanel">
      <header class="panel-header">
        <div class="panel-header-row">
          <div class="panel-title">Live log</div>
          <button type="button" class="btn btn-clear" onClick={() => logStore.setValue([])}>
            Clear
          </button>
        </div>
      </header>

      {log && log.length === 0 ? (
        <div class="empty-state">No matched requests yet — enable a profile and browse.</div>
      ) : (
        <div class="log-list">
          {(log ?? []).map((entry) => (
            <LogCard entry={entry} cfg={cfg} key={entry.id} />
          ))}
        </div>
      )}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
