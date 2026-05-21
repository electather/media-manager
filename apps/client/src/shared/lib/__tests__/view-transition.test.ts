import { describe, expect, it } from "vite-plus/test";

import { isExpectedTransitionAbort } from "../view-transition";

describe("isExpectedTransitionAbort", () => {
  it.each([
    ["AbortError", "Skipped ViewTransition due to document being hidden"],
    ["AbortError", "Transition was skipped"],
    ["TimeoutError", "Transition was aborted because of timeout in DOM update"],
    ["TimeoutError", "Skipped ViewTransition due to timeout"],
    ["InvalidStateError", "Transition was aborted because of invalid state"],
  ])("treats DOMException(%s) as expected", (name, message) => {
    expect(isExpectedTransitionAbort(new DOMException(message, name))).toBe(true);
  });

  it("does not swallow unexpected DOMException names", () => {
    expect(isExpectedTransitionAbort(new DOMException("nope", "SyntaxError"))).toBe(false);
  });

  it("does not swallow plain errors thrown from the DOM update callback", () => {
    expect(isExpectedTransitionAbort(new Error("AbortError"))).toBe(false);
    expect(isExpectedTransitionAbort(new TypeError("oops"))).toBe(false);
  });

  it("rejects non-error rejection reasons", () => {
    expect(isExpectedTransitionAbort(undefined)).toBe(false);
    expect(isExpectedTransitionAbort(null)).toBe(false);
    expect(isExpectedTransitionAbort("AbortError")).toBe(false);
    expect(isExpectedTransitionAbort({ name: "AbortError" })).toBe(false);
  });
});
