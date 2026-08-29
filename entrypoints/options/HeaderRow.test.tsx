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
  it("is true when an append value looks like JSON but doesn't parse", () => {
    expect(ruleHasBlockingError({ ...baseRule(), op: "append", value: "{nope}" })).toBe(true);
  });
  it("ignores the value for a remove rule", () => {
    expect(ruleHasBlockingError({ ...baseRule(), op: "remove", value: "{nope}" })).toBe(false);
  });
  it("is true for an append rule on a header Chrome doesn't support appending to", () => {
    expect(ruleHasBlockingError({ ...baseRule(), op: "append", name: "Authorization", value: "x" })).toBe(true);
  });
  it("is false for an append rule on a header Chrome does support", () => {
    expect(ruleHasBlockingError({ ...baseRule(), op: "append", name: "Cookie", value: "x" })).toBe(false);
  });
  it("ignores the allowlist check while the header name is still empty", () => {
    expect(ruleHasBlockingError({ ...baseRule(), op: "append", name: "", value: "x" })).toBe(false);
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

describe("HeaderRow append option", () => {
  it("renders an Append option in the op select", () => {
    const { container } = render(<HeaderRow rule={baseRule()} onChange={() => {}} onDelete={() => {}} />);
    const options = Array.from(container.querySelectorAll(".select-op option")).map((o) => o.textContent);
    expect(options).toEqual(["Set", "Append", "Remove"]);
  });
  it("shows a value editor (not the disabled placeholder) for an append rule", () => {
    const rule: HeaderRule = { ...baseRule(), op: "append" };
    const { container } = render(<HeaderRow rule={rule} onChange={() => {}} onDelete={() => {}} />);
    expect(container.querySelector(".value-disabled")).toBeNull();
  });
  it("renders a help icon with a title explaining append semantics", () => {
    const rule: HeaderRule = { ...baseRule(), op: "append" };
    const { container } = render(<HeaderRow rule={rule} onChange={() => {}} onDelete={() => {}} />);
    const help = container.querySelector(".help-icon");
    expect(help).toBeTruthy();
    expect(help!.getAttribute("title")).toMatch(/appropriate separator/i);
  });
  it("keeps the help icon in the DOM (visually hidden) for non-append rules, to avoid row misalignment", () => {
    const { container } = render(<HeaderRow rule={baseRule()} onChange={() => {}} onDelete={() => {}} />);
    const help = container.querySelector(".help-icon") as HTMLElement | null;
    expect(help).toBeTruthy();
    expect(help!.style.visibility).toBe("hidden");
  });
});

describe("HeaderRow all-URLs override indicator", () => {
  const ALL: HeaderRule["matcher"] = { mode: "regex", value: ".*" };
  const NARROW = { mode: "domain", value: "example.com" } as const;
  const NOTE = /override sends these headers to every URL/i;

  it("flags a live all-URLs override even while the override panel is collapsed", () => {
    const rule: HeaderRule = { ...baseRule(), matcher: { ...ALL! } };
    const { container } = render(
      <HeaderRow rule={rule} onChange={() => {}} onDelete={() => {}} profileMatcher={NARROW} />,
    );
    fireEvent.click(screen.getByTitle("Override match")); // collapse the panel
    const note = container.querySelector(".rule-scope-note.helper-warn");
    expect(note).toBeTruthy();
    expect(note!.textContent).toMatch(NOTE);
  });

  it("does not flag a rule whose override is narrow", () => {
    const rule: HeaderRule = { ...baseRule(), matcher: { ...NARROW } };
    render(<HeaderRow rule={rule} onChange={() => {}} onDelete={() => {}} profileMatcher={NARROW} />);
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("does not flag a rule with no override — the profile-level nudge covers that", () => {
    render(
      <HeaderRow rule={baseRule()} onChange={() => {}} onDelete={() => {}} profileMatcher={{ ...ALL! }} />,
    );
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("does not flag a disabled or Remove rule — neither sends anything", () => {
    render(
      <HeaderRow
        rule={{ ...baseRule(), enabled: false, matcher: { ...ALL! } }}
        onChange={() => {}}
        onDelete={() => {}}
        profileMatcher={NARROW}
      />,
    );
    expect(screen.queryByText(NOTE)).toBeNull();
    cleanup();
    render(
      <HeaderRow
        rule={{ ...baseRule(), op: "remove", matcher: { ...ALL! } }}
        onChange={() => {}}
        onDelete={() => {}}
        profileMatcher={NARROW}
      />,
    );
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("does not flag an all-URLs override on a disabled profile — compileRules emits nothing", () => {
    const rule: HeaderRule = { ...baseRule(), matcher: { ...ALL! } };
    const { container } = render(
      <HeaderRow
        rule={rule}
        onChange={() => {}}
        onDelete={() => {}}
        profileMatcher={NARROW}
        profileEnabled={false}
      />,
    );
    expect(screen.queryByText(NOTE)).toBeNull();
    // The override panel's own nudge stays calm too, matching the profile control.
    const helper = container.querySelector(".override-panel .helper")!;
    expect(helper.classList.contains("helper-warn")).toBe(false);
    expect(helper.textContent).toMatch(/Applies to every URL/);
  });

  it("escalates the override panel's own nudge for a live all-URLs override", () => {
    const rule: HeaderRule = { ...baseRule(), matcher: { ...ALL! } };
    const { container } = render(
      <HeaderRow rule={rule} onChange={() => {}} onDelete={() => {}} profileMatcher={NARROW} />,
    );
    const helper = container.querySelector(".override-panel .helper")!;
    expect(helper.classList.contains("helper-warn")).toBe(true);
    expect(helper.textContent).toMatch(/sent to every URL/);
  });
});
