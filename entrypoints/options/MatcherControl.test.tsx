import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/preact";
import type { Matcher } from "../../src/types";
import { MatcherControl, regexLiteralWarning } from "./MatcherControl";

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

describe("regexLiteralWarning", () => {
  const suggestionFor = (v: string) => regexLiteralWarning("regex", v)?.suggestion ?? null;

  it("ignores every mode but Custom regex", () => {
    expect(regexLiteralWarning("contains", "/api/g")).toBeNull();
    expect(regexLiteralWarning("domain", "/api/g")).toBeNull();
  });

  it("offers the pattern inside the delimiters, dropping any flags clause", () => {
    // The repro from #41: valid JS and valid RE2, so nothing else catches it.
    expect(suggestionFor("/api/g")).toBe("api");
    expect(suggestionFor("/^https:\\/\\/api\\./i")).toBe("^https:\\/\\/api\\.");
    expect(suggestionFor("/^https:\\/\\/api\\./")).toBe("^https:\\/\\/api\\.");
  });

  it("sees through surrounding whitespace, since the literal form arrives pasted", () => {
    expect(suggestionFor("  /api/g  ")).toBe("api");
  });

  it("leaves an ordinary bare pattern alone", () => {
    expect(suggestionFor("^https://.*\\.dev/")).toBeNull();
    expect(suggestionFor("/api/users")).toBeNull();
    expect(suggestionFor(".*")).toBeNull();
    expect(suggestionFor("")).toBeNull();
    expect(suggestionFor("   ")).toBeNull();
  });

  it("does not read a repeated flag letter as a flags clause", () => {
    // "gg" is not a legal JS flags string, so "/api/gg" is just a path pattern.
    expect(suggestionFor("/api/gg")).toBeNull();
  });

  it("does not read an escaped closing slash as a delimiter", () => {
    // "/log\/" is the bare pattern for URLs containing "/log/", not a literal.
    expect(suggestionFor("/log\\/")).toBeNull();
    // ...but an escaped backslash before the closing slash is a real delimiter.
    expect(suggestionFor("/log\\\\/")).toBe("log\\\\");
  });

  it("needs a non-empty body, so a lone or doubled slash is not a literal", () => {
    expect(suggestionFor("/")).toBeNull();
    expect(suggestionFor("//")).toBeNull();
  });

  it("still warns on a path pattern whose last segment is spelled in flag letters", () => {
    // "/users/id" parses as body "users" + flags "id" and nothing distinguishes
    // it from "/api/gi". Pinned deliberately: the copy offers a reading rather
    // than asserting a mistake, so a false positive here costs the user a
    // glance, not a wrong correction.
    expect(suggestionFor("/users/id")).toBe("users");
    expect(suggestionFor("/api/v")).toBe("api");
  });

  it("reports a flags clause only when one is present, since it gates the field tint", () => {
    expect(regexLiteralWarning("regex", "/api/g")!.hasFlags).toBe(true);
    // "/api/" is the ordinary bare pattern for a path segment — delimiter-shaped
    // with no evidence behind it, so it gets the helper line and no tint.
    expect(regexLiteralWarning("regex", "/api/")!.hasFlags).toBe(false);
    expect(suggestionFor("/api/")).toBe("api");
  });
});

describe("MatcherControl regex literal warning", () => {
  it("warns in the helper and tints the field without blocking the value", () => {
    const c = mount({ mode: "regex", value: "/api/g" });
    const helper = c.container.querySelector(".helper")!;
    expect(helper.textContent).toMatch(/Leading and trailing \/ are matched literally/);
    expect(helper.querySelector("code")!.textContent).toBe("api");
    expect(helper.classList.contains("helper-warn")).toBe(true);
    expect(helper.classList.contains("helper-danger")).toBe(false);
    expect(helper.getAttribute("role")).toBe("status");
    expect(c.value()!.classList.contains("input-warn")).toBe(true);
    expect(c.value()!.classList.contains("input-danger")).toBe(false);
    // The value is left exactly as typed — this warns, it does not strip (#41).
    expect(c.matcher).toEqual({ mode: "regex", value: "/api/g" });
  });

  it("leaves the field untinted for a delimiter-only value, which is often correct", () => {
    const c = mount({ mode: "regex", value: "/api/" });
    const helper = c.container.querySelector(".helper")!;
    expect(helper.classList.contains("helper-warn")).toBe(true);
    expect(c.value()!.classList.contains("input-warn")).toBe(false);
  });

  it("shows the normal hint once the delimiters are gone", () => {
    const c = mount({ mode: "regex", value: "/api/g" });
    fireEvent.input(c.value()!, { target: { value: "api" } });
    c.sync();
    const helper = c.container.querySelector(".helper")!;
    expect(helper.classList.contains("helper-warn")).toBe(false);
    expect(helper.textContent).toMatch(/e\.g\./);
  });

  it("lets a hard regex error win over the shape warning", () => {
    // "/(/" is both unparseable and literal-shaped; the error is what blocks the
    // rule, so it must not be buried under a hint about delimiters.
    const c = mount({ mode: "regex", value: "/(/" });
    const helper = c.container.querySelector(".helper")!;
    expect(helper.classList.contains("helper-danger")).toBe(true);
    expect(helper.textContent).toMatch(/Invalid regular expression/);
    expect(c.value()!.classList.contains("input-danger")).toBe(true);
    expect(c.value()!.classList.contains("input-warn")).toBe(false);
  });
});
