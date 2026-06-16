import { describe, expect, it } from "vite-plus/test";
import { DiagnosticsApiError, diagnosticsErrorMessage } from "../types";

describe("diagnosticsErrorMessage", () => {
  // The retention toast and the boundary fallback both need the server-shipped
  // devMessage, not the generic Error string, so an operator sees *why* the
  // diagnostics call failed instead of "Diagnostics API 500".
  it("prefers the server devMessage on a DiagnosticsApiError", () => {
    const error = new DiagnosticsApiError(500, {
      code: "diagnostics.retention.invalid",
      devMessage: "retention window must be one of the allowed presets",
    });
    expect(diagnosticsErrorMessage(error)).toBe(
      "retention window must be one of the allowed presets",
    );
  });

  // When the body carries no devMessage the class super() falls back to a
  // synthesised message; the helper must surface that rather than empty string.
  it("falls back to the Error message when the body has no devMessage", () => {
    const error = new DiagnosticsApiError(503, null);
    expect(diagnosticsErrorMessage(error)).toBe("Diagnostics API 503");
  });

  it("uses the message for a plain Error", () => {
    expect(diagnosticsErrorMessage(new Error("network down"))).toBe("network down");
  });

  // Mutation onError can receive any throwable; stringify keeps the toast safe
  // instead of rendering "undefined".
  it("stringifies non-Error throwables", () => {
    expect(diagnosticsErrorMessage("boom")).toBe("boom");
  });
});
