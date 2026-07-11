import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import type { Config, Profile } from "../../src/types";
import { encodeShare } from "../../src/lib/share";

let currentConfig: Config;
const watchers: ((c: Config) => void)[] = [];

vi.mock("../../src/lib/storage", () => ({
  configStore: {
    getValue: () => Promise.resolve(currentConfig),
    setValue: (next: Config) => {
      currentConfig = next;
      watchers.forEach((w) => w(next));
      return Promise.resolve();
    },
    watch: (cb: (c: Config) => void) => {
      watchers.push(cb);
      return () => {
        const i = watchers.indexOf(cb);
        if (i >= 0) watchers.splice(i, 1);
      };
    },
  },
}));

// Import after the mock so main.tsx's top-level import resolves to the mocked module.
const { ImportModal } = await import("./ImportModal");

const existingProfile: Profile = {
  id: "existing-id",
  name: "Auth",
  enabled: true,
  matcher: { mode: "domain", value: "old.example.com" },
  rules: [{ id: "old-rule", enabled: true, op: "set", name: "X-Old", value: "old" }],
};

function baseConfig(): Config {
  return { version: 1, masterEnabled: true, profiles: [{ ...existingProfile, rules: [...existingProfile.rules] }] };
}

beforeEach(() => {
  currentConfig = baseConfig();
  watchers.length = 0;
  cleanup();
});

describe("Import flow", () => {
  it("colliding profile name prompts Overwrite; choosing Overwrite replaces contents, keeps id", async () => {
    const incoming: Profile = {
      id: "",
      name: "Auth",
      enabled: false,
      matcher: { mode: "contains", value: "new.example.com" },
      rules: [{ id: "", enabled: true, op: "set", name: "X-New", value: "new" }],
    };
    const shareStr = encodeShare({ kind: "p", profile: incoming });

    let applied: Config | null = null;
    render(
      <ImportModal
        config={currentConfig}
        onClose={() => {}}
        onApply={(next) => {
          applied = next;
        }}
      />,
    );

    const textarea = screen.getByPlaceholderText(/paste share string/i);
    fireEvent.input(textarea, { target: { value: shareStr } });
    fireEvent.click(screen.getByText("Import"));

    // Collision confirm should appear.
    expect(await screen.findByText(/Overwrite "Auth"\?/)).toBeTruthy();

    fireEvent.click(screen.getByText("Overwrite"));

    expect(applied).not.toBeNull();
    const result = applied as unknown as Config;
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].id).toBe("existing-id"); // kept existing id
    expect(result.profiles[0].name).toBe("Auth");
    expect(result.profiles[0].matcher.value).toBe("new.example.com"); // contents replaced
    expect(result.profiles[0].rules[0].name).toBe("X-New");
    expect(result.profiles[0].rules[0].id).not.toBe(""); // fresh id assigned
  });

  it("corrupt share string shows an error and applies nothing", async () => {
    let applied: Config | null = null;
    let closed = false;
    render(
      <ImportModal
        config={currentConfig}
        onClose={() => {
          closed = true;
        }}
        onApply={(next) => {
          applied = next;
        }}
      />,
    );

    const textarea = screen.getByPlaceholderText(/paste share string/i);
    fireEvent.input(textarea, { target: { value: "not-a-valid-share-string" } });
    fireEvent.click(screen.getByText("Import"));

    expect(await screen.findByText(/⚠/)).toBeTruthy();
    expect(applied).toBeNull();
    expect(closed).toBe(false);
  });
});
