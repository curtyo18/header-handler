import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import type { HeaderRule } from "../../src/types";
import { HeaderRow } from "./HeaderRow";

afterEach(cleanup);

function baseRule(): HeaderRule {
  return { id: "r1", enabled: true, op: "set", name: "X-Test", value: "v" };
}

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
