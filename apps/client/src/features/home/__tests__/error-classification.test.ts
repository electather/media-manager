// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { classifyHomeError } from "../lib/error-classification";
import { HomeApiError } from "../lib/types";

function withOffline(value: boolean, fn: () => void) {
  const original = Object.getOwnPropertyDescriptor(navigator, "onLine");
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => value });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(navigator, "onLine", original);
    else delete (navigator as { onLine?: boolean }).onLine;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifyHomeError", () => {
  it("classifies 401 + http.unauthorized as auth", () => {
    const view = classifyHomeError(new HomeApiError(401, { code: "http.unauthorized" }));
    expect(view.variant).toBe("auth");
    expect(view.needsRelogin).toBe(true);
    expect(view.code).toBe("http.unauthorized");
    expect(view.status).toBe(401);
  });

  it("classifies plugin.token_expired as auth even on 200 envelopes", () => {
    const view = classifyHomeError(new HomeApiError(200, { code: "plugin.token_expired" }));
    expect(view.variant).toBe("auth");
  });

  it("classifies offline navigator state as offline", () => {
    withOffline(false, () => {
      const view = classifyHomeError(new Error("network down"));
      expect(view.variant).toBe("offline");
    });
  });

  it("classifies plugin.timeout as network", () => {
    const view = classifyHomeError(new HomeApiError(504, { code: "plugin.timeout" }));
    expect(view.variant).toBe("network");
  });

  it("classifies 5xx as server", () => {
    const view = classifyHomeError(new HomeApiError(503, { code: "home.internal" }));
    expect(view.variant).toBe("server");
  });

  it("falls back to unknown for non-typed errors with online navigator", () => {
    const view = classifyHomeError(new Error("boom"));
    expect(view.variant).toBe("unknown");
    expect(view.needsRelogin).toBe(false);
  });

  it("prefers body.message over body.devMessage for the surfaced detail", () => {
    const view = classifyHomeError(
      new HomeApiError(500, { code: "home.internal", message: "user", devMessage: "dev" }),
    );
    expect(view.devMessage).toBe("user");
  });

  it("falls back to body.devMessage when message is empty", () => {
    const view = classifyHomeError(
      new HomeApiError(500, { code: "home.internal", devMessage: "dev only" }),
    );
    expect(view.devMessage).toBe("dev only");
  });

  it("prefers offline over auth when navigator is offline and a 401 is thrown", () => {
    // Reachability is the user's first blocker — fix connectivity first, then
    // re-attempt to see the real auth state.
    withOffline(false, () => {
      const view = classifyHomeError(new HomeApiError(401, { code: "http.unauthorized" }));
      expect(view.variant).toBe("offline");
      expect(view.needsRelogin).toBe(false);
    });
  });
});
