import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/preact";
import type { Config, HeaderRule } from "../../src/types";

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
  CONFIG_SOFT_CAP_BYTES: 86016,
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
    expect(screen.getByText(/over Chrome's ~84 KB sync-storage budget/i)).toBeTruthy();
    expect(screen.queryByText("Saved")).toBeNull();
  });
});

describe("New profile default matcher (#38)", () => {
  it("creates a profile scoped to All URLs and nudges the user to scope it", async () => {
    render(<App />);
    await screen.findByDisplayValue("Auth");

    fireEvent.click(screen.getByText("＋ New profile"));

    const modeSelect = await screen.findByDisplayValue("All URLs");
    expect(modeSelect).toBeTruthy();
    expect(screen.getByText(/Applies to every URL/i)).toBeTruthy();
    // No rules yet, so the calm state — not the escalated warning.
    expect(screen.queryByText(/sent to every URL/i)).toBeNull();
  });
});

describe("Header name column width (#37 follow-up)", () => {
  function configWithNames(names: string[]): Config {
    return {
      version: 1,
      masterEnabled: true,
      profiles: [
        {
          id: "p1",
          name: "Auth",
          enabled: true,
          matcher: { mode: "contains", value: "example.com" },
          rules: names.map((name, i): HeaderRule => ({ id: `r${i}`, enabled: true, op: "set", name, value: "1" })),
        },
      ],
    };
  }

  // The container carries the one width the heading and every name field read.
  async function renderNames(names: string[]): Promise<HTMLElement> {
    cleanup();
    currentConfig = configWithNames(names);
    render(<App />);
    await screen.findByDisplayValue("Auth");
    return document.querySelector(".rules-body") as HTMLElement;
  }

  function width(el: HTMLElement): number {
    return parseFloat(el.style.getPropertyValue("--name-width"));
  }

  it("widens the column for a long header name", async () => {
    const short = width(await renderNames(["X-A"]));
    const long = width(await renderNames(["Access-Control-Allow-Credentials"]));
    expect(long).toBeGreaterThan(short);
  });

  it("gives every name field in the profile the same width, not one per row", async () => {
    const body = await renderNames(["X-A", "Access-Control-Allow-Credentials", "Accept"]);
    const inputs = Array.from(document.querySelectorAll<HTMLElement>(".header-name-input"));
    expect(inputs).toHaveLength(3);
    // Uniform by construction: no field sizes itself, they all resolve the same
    // --name-width off the single container above them.
    for (const input of inputs) {
      expect(input.style.width).toBe("");
      expect(input.closest(".rules-body")).toBe(body);
    }
    expect(width(body)).toBeGreaterThan(0);
  });

  it("falls back to the floor width with no rules or empty names", async () => {
    const floor = width(await renderNames([]));
    expect(floor).toBeGreaterThan(0);
    expect(width(await renderNames(["", ""]))).toBe(floor);
    expect(width(await renderNames(["X-A"]))).toBe(floor);
  });
});
