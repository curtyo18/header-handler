import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import type { HeaderRule } from "../../src/types";
import { HeaderRow, ruleHasBlockingError } from "./HeaderRow";

afterEach(cleanup);

function baseRule(): HeaderRule {
  return { id: "r1", enabled: true, op: "set", name: "X-Test", value: "v" };
}

describe("ruleHasBlockingError", () => {
  it("is false for a well-formed rule", () => {
    expect(ruleHasBlockingError(baseRule())).toBe(false);
  });
  it("is true when an override matcher regex is invalid", () => {
    expect(ruleHasBlockingError({ ...baseRule(), matcher: { mode: "regex", value: "(" } })).toBe(true);
  });
  it("is true when a set value looks like JSON but doesn't parse", () => {
    expect(ruleHasBlockingError({ ...baseRule(), value: "{nope}" })).toBe(true);
  });
  it("ignores the value for a remove rule", () => {
    expect(ruleHasBlockingError({ ...baseRule(), op: "remove", value: "{nope}" })).toBe(false);
  });
});

describe("HeaderRow blocked state", () => {
  it("shows the 'won't apply' note for a rule with a blocking error", () => {
    const rule: HeaderRule = { ...baseRule(), matcher: { mode: "regex", value: "(" } };
    const { container } = render(<HeaderRow rule={rule} onChange={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/won't apply/i)).toBeTruthy();
    expect(container.querySelector(".rule-card-blocked")).toBeTruthy();
  });
  it("shows no such note for a valid rule", () => {
    const { container } = render(<HeaderRow rule={baseRule()} onChange={() => {}} onDelete={() => {}} />);
    expect(screen.queryByText(/won't apply/i)).toBeNull();
    expect(container.querySelector(".rule-card-blocked")).toBeNull();
  });
});

describe("HeaderRow override toggle", () => {
  it("opening then closing the override panel without typing a value leaves rule.matcher unset", () => {
    const rule = baseRule();
    let current = rule;
    const { rerender } = render(<HeaderRow rule={current} onChange={(next) => (current = next)} onDelete={() => {}} />);

    fireEvent.click(screen.getByTitle("Override match"));
    expect(current.matcher).toEqual({ mode: "contains", value: "" });

    rerender(<HeaderRow rule={current} onChange={(next) => (current = next)} onDelete={() => {}} />);
    fireEvent.click(screen.getByTitle("Override match"));

    expect(current.matcher).toBeUndefined();
  });

  it("switching the mode dropdown without ever typing a value still clears on close", () => {
    const rule = baseRule();
    let current = rule;
    const { rerender, container } = render(<HeaderRow rule={current} onChange={(next) => (current = next)} onDelete={() => {}} />);

    fireEvent.click(screen.getByTitle("Override match"));
    rerender(<HeaderRow rule={current} onChange={(next) => (current = next)} onDelete={() => {}} />);

    fireEvent.change(container.querySelector(".matcher-mode")!, { target: { value: "domain" } });
    expect(current.matcher).toEqual({ mode: "domain", value: "" });
    rerender(<HeaderRow rule={current} onChange={(next) => (current = next)} onDelete={() => {}} />);

    fireEvent.click(screen.getByTitle("Override match"));

    expect(current.matcher).toBeUndefined();
  });

  it("closing the panel after typing a value keeps the matcher", () => {
    const rule = baseRule();
    let current = rule;
    const { rerender } = render(<HeaderRow rule={current} onChange={(next) => (current = next)} onDelete={() => {}} />);

    fireEvent.click(screen.getByTitle("Override match"));
    rerender(<HeaderRow rule={current} onChange={(next) => (current = next)} onDelete={() => {}} />);

    fireEvent.input(screen.getByPlaceholderText("value to match"), { target: { value: "example.com" } });
    rerender(<HeaderRow rule={current} onChange={(next) => (current = next)} onDelete={() => {}} />);

    fireEvent.click(screen.getByTitle("Override match"));

    expect(current.matcher).toEqual({ mode: "contains", value: "example.com" });
  });
});
