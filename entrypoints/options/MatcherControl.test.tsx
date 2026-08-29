import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import type { Matcher } from "../../src/types";
import { MatcherControl } from "./MatcherControl";

afterEach(cleanup);

// Renders a controlled MatcherControl and hands back the latest matcher.
function mount(initial: Matcher, escalated?: boolean) {
  let current = initial;
  const view = render(
    <MatcherControl matcher={current} onChange={(next) => (current = next)} escalated={escalated} />,
  );
  const sync = () =>
    view.rerender(
      <MatcherControl matcher={current} onChange={(next) => (current = next)} escalated={escalated} />,
    );
  return {
    ...view,
    sync,
    get matcher() {
      return current;
    },
    mode: () => view.container.querySelector(".matcher-mode") as HTMLSelectElement,
    value: () => view.container.querySelector(".matcher-value") as HTMLInputElement | null,
  };
}

describe("MatcherControl mode switching", () => {
  it("selecting All URLs writes the regex .* encoding", () => {
    const c = mount({ mode: "contains", value: "example.com" });
    fireEvent.change(c.mode(), { target: { value: "all" } });
    expect(c.matcher).toEqual({ mode: "regex", value: ".*" });
  });

  it("shows All URLs as the selected option for a .* regex matcher", () => {
    const c = mount({ mode: "regex", value: ".*" });
    expect(c.mode().value).toBe("all");
    expect(c.value()).toBeNull();
  });

  it("leaving All URLs for a non-regex mode clears the value", () => {
    const c = mount({ mode: "regex", value: ".*" });
    fireEvent.change(c.mode(), { target: { value: "contains" } });
    // Carrying ".*" into Contains would look scoped but match only URLs
    // literally containing ".*".
    expect(c.matcher).toEqual({ mode: "contains", value: "" });
  });

  it("leaving All URLs for Custom regex keeps .* as editable seed text", () => {
    const c = mount({ mode: "regex", value: ".*" });
    fireEvent.change(c.mode(), { target: { value: "regex" } });
    expect(c.matcher).toEqual({ mode: "regex", value: ".*" });
    c.sync();
    expect(c.value()).not.toBeNull();
  });

  it("keeps the value input mounted while typing '.*' into it, so a .*-prefixed regex is typable", () => {
    const c = mount({ mode: "regex", value: "" });
    const input = c.value()!;
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: "." } });
    c.sync();
    fireEvent.input(c.value()!, { target: { value: ".*" } });
    c.sync();

    // The select flips its label to All URLs (ADR-0008) but the field the user
    // is typing in must not be torn out from under the caret.
    expect(c.mode().value).toBe("all");
    expect(c.value()).not.toBeNull();

    fireEvent.input(c.value()!, { target: { value: ".*\\.dev" } });
    c.sync();
    expect(c.matcher).toEqual({ mode: "regex", value: ".*\\.dev" });
  });

  it("hides the value input again once an all-URLs field loses focus", () => {
    const c = mount({ mode: "regex", value: "" });
    const input = c.value()!;
    fireEvent.focus(input);
    fireEvent.input(input, { target: { value: ".*" } });
    c.sync();
    fireEvent.blur(c.value()!);
    c.sync();
    expect(c.value()).toBeNull();
  });
});

describe("MatcherControl all-URLs nudge", () => {
  it("shows the calm nudge with no warning styling by default", () => {
    const { container } = render(
      <MatcherControl matcher={{ mode: "regex", value: ".*" }} onChange={() => {}} />,
    );
    const helper = container.querySelector(".helper")!;
    expect(helper.textContent).toMatch(/Applies to every URL/);
    expect(helper.classList.contains("helper-warn")).toBe(false);
    expect(helper.getAttribute("role")).toBe("status");
  });

  it("renders the escalated warning when escalated is set", () => {
    const { container } = render(
      <MatcherControl matcher={{ mode: "regex", value: ".*" }} onChange={() => {}} escalated />,
    );
    const helper = container.querySelector(".helper")!;
    expect(helper.textContent).toMatch(/sent to every URL/);
    expect(helper.classList.contains("helper-warn")).toBe(true);
    expect(helper.getAttribute("role")).toBe("status");
  });
});

describe("MatcherControl all-URLs value field", () => {
  // Not a user-reachable transition: the select's DOM value is already "all"
  // here, and a browser fires no change event when the selected option is
  // re-picked. This pins selectMode's All-URLs branch closing the value field.
  it("selectMode's All URLs branch closes the value field", () => {
    const c = mount({ mode: "regex", value: ".*" });
    fireEvent.change(c.mode(), { target: { value: "regex" } });
    c.sync();
    expect(c.value()).not.toBeNull();
    fireEvent.change(c.mode(), { target: { value: "all" } });
    c.sync();
    expect(c.value()).toBeNull();
  });
});
