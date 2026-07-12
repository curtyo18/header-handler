import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/preact";
import type { Config } from "../../src/types";

function baseConfig(): Config {
  return {
    version: 1,
    masterEnabled: true,
    profiles: [
      {
        id: "p1",
        name: "Auth",
        enabled: true,
        matcher: { mode: "contains", value: "example.com" },
        rules: [{ id: "r1", enabled: true, op: "set", name: "X-A", value: "1" }],
      },
    ],
  };
}

let currentConfig: Config;
// setValue rejects to simulate an over-quota write — the whole point of issue #5.
const setValue = vi.fn(() => Promise.reject(new Error("QUOTA_BYTES_PER_ITEM quota exceeded")));

vi.mock("../../src/lib/storage", () => ({
  SYNC_ITEM_QUOTA_BYTES: 8192,
  configStorageBytes: () => 100, // well under quota; the near-quota banner is out of scope here
  configStore: {
    getValue: () => Promise.resolve(currentConfig),
    setValue,
    watch: () => () => {},
  },
  dnrErrorStore: {
    getValue: () => Promise.resolve(null),
    watch: () => () => {},
  },
}));

const { App } = await import("./main");

beforeEach(() => {
  currentConfig = baseConfig();
  setValue.mockClear();
  cleanup();
});

describe("Options save-failure surfacing (#5)", () => {
  it("shows a 'Save failed' pill and a quota message when a write is rejected, not 'Saved'", async () => {
    render(<App />);

    // Wait for the config to load and the profile editor to appear.
    const nameInput = await screen.findByDisplayValue("Auth");

    // Editing the profile name triggers update() → configStore.setValue → reject.
    fireEvent.input(nameInput, { target: { value: "Auth 2" } });

    await waitFor(() => expect(screen.getByText("Save failed")).toBeTruthy());
    expect(screen.getByText(/over Chrome's 8 KB sync-storage limit/i)).toBeTruthy();
    expect(screen.queryByText("Saved")).toBeNull();
  });
});
