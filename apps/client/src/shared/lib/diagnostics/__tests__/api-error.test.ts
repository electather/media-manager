import { describe, expect, it } from "vite-plus/test";

import { BaseApiError, errorMessage } from "../api-error";

describe("errorMessage", () => {
  // Mutation onError handlers need a single user-facing string regardless of
  // what was thrown, so the helper must read .message off any Error subclass
  // (including the feature ApiError classes) and stringify everything else.
  it("returns the message of a plain Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the derived message of a BaseApiError subclass", () => {
    // The body message wins over the fallback, mirroring how a feature's
    // ApiError surfaces a backend error string to the toast.
    const err = new BaseApiError("FeatureApiError", 409, { message: "conflict" }, "fallback");
    expect(errorMessage(err)).toBe("conflict");
  });

  it("falls back to the constructor fallback when the body has no message", () => {
    const err = new BaseApiError("FeatureApiError", 500, null, "request failed (500)");
    expect(errorMessage(err)).toBe("request failed (500)");
  });

  it("stringifies non-Error values rather than leaking [object Object]", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
  });
});
