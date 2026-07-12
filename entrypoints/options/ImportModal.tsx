import { useState } from "preact/hooks";
import type { Config, Profile } from "../../src/types";
import { decodeShare } from "../../src/lib/share";

function withFreshIds(p: Profile): Profile {
  return { ...p, id: crypto.randomUUID(), rules: p.rules.map((r) => ({ ...r, id: crypto.randomUUID() })) };
}

export function ImportModal({
  config,
  onClose,
  onApply,
}: {
  config: Config;
  onClose: () => void;
  onApply: (next: Config) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Pending collision queue: profiles still needing a decision, plus results collected so far.
  const [pending, setPending] = useState<Profile[] | null>(null);
  const [resolved, setResolved] = useState<Profile[]>([]);
  const [applyToAll, setApplyToAll] = useState(false);
  const [isBundle, setIsBundle] = useState(false);

  function findExisting(name: string): Profile | undefined {
    return config.profiles.find((p) => p.name === name);
  }

  function finish(finalProfiles: Profile[]) {
    let profiles = config.profiles.slice();
    for (const incoming of finalProfiles) {
      const existingIdx = profiles.findIndex((p) => p.name === incoming.name);
      if (existingIdx >= 0) {
        // Overwrite: replace contents but keep the existing id.
        profiles[existingIdx] = { ...incoming, id: profiles[existingIdx].id };
      } else {
        profiles.push(incoming);
      }
    }
    onApply({ ...config, profiles });
    onClose();
  }

  function processQueue(queue: Profile[], acc: Profile[], skipConfirmForAll: boolean) {
    if (queue.length === 0) {
      finish(acc);
      return;
    }
    const [head, ...rest] = queue;
    // A name can collide with an existing profile OR with one accepted earlier in
    // this same bundle — check both, or two same-named profiles in one bundle
    // silently overwrite each other in finish().
    const existing = findExisting(head.name) ?? acc.find((p) => p.name === head.name);
    if (existing && !skipConfirmForAll) {
      setPending(queue);
      setResolved(acc);
      return;
    }
    processQueue(rest, [...acc, head], skipConfirmForAll);
  }

  function handleSubmit() {
    setError(null);
    // Keep withFreshIds inside the try: decodeShare now validates shape, but a
    // future format change (or a bug) shouldn't throw an unhandled error into
    // the click handler and fail the import with no visible feedback.
    try {
      const decoded = decodeShare(text.trim());
      if (decoded.kind === "p") {
        setIsBundle(false);
        processQueue([withFreshIds(decoded.profile)], [], false);
      } else {
        setIsBundle(true);
        processQueue(decoded.profiles.map(withFreshIds), [], false);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function handleOverwrite() {
    if (!pending) return;
    const [head, ...rest] = pending;
    const acc = [...resolved, head];
    if (applyToAll) {
      processQueue(rest, acc, true);
    } else {
      setPending(null);
      processQueue(rest, acc, false);
    }
  }

  function handleCancelOne() {
    if (!pending) return;
    const [, ...rest] = pending;
    if (applyToAll) {
      // "apply to all" + Cancel means skip every remaining collision too; keep only non-colliding ones.
      processQueue(
        rest.filter((p) => !findExisting(p.name)),
        resolved,
        false,
      );
      return;
    }
    setPending(null);
    processQueue(rest, resolved, false);
  }

  if (pending && pending.length > 0) {
    const name = pending[0].name;
    return (
      <div class="modal-overlay">
        <div class="modal confirm-modal">
          <div class="modal-title">Overwrite "{name}"?</div>
          <div class="modal-body-text">
            A profile named "{name}" already exists. Overwrite replaces its contents but keeps its id.
          </div>
          {isBundle && (
            <label class="apply-all-row">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll((e.target as HTMLInputElement).checked)}
              />
              Apply to all remaining collisions
            </label>
          )}
          <div class="modal-actions">
            <button type="button" class="btn" onClick={handleCancelOne}>
              Cancel
            </button>
            <button type="button" class="btn btn-accent-solid" onClick={handleOverwrite}>
              Overwrite
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="modal-overlay">
      <div class="modal">
        <div class="modal-title">Import profiles</div>
        <textarea
          class="import-textarea"
          placeholder="Paste share string here…"
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />
        {error && <div class="helper helper-danger">⚠ {error}</div>}
        <div class="modal-actions">
          <button type="button" class="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="btn btn-accent-solid" onClick={handleSubmit} disabled={text.trim() === ""}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
