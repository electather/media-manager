import { describe, it, expect, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    APP_EXTERNAL_URL: "https://media.example.com",
  },
}));

vi.mock("../internal/host-bridge", () => ({
  buildStore: () => ({
    get: async () => null,
    set: async () => {},
    delete: async () => {},
  }),
}));

vi.mock("../internal/fetch-policy", () => ({
  buildFetch: () => async () => new Response(""),
  buildLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

const { buildContext } = await import("../internal/context");

describe("buildContext", () => {
  it("populates ctx.appBaseUrl from the provided argument", () => {
    const ctx = buildContext({
      pluginId: "trakt",
      allowedHosts: [],
      userId: null,
      appBaseUrl: "https://media.example.com",
    });
    expect(ctx.appBaseUrl).toBe("https://media.example.com");
  });

  it("preserves the given appBaseUrl verbatim (no normalisation)", () => {
    const ctx = buildContext({
      pluginId: "plex",
      allowedHosts: [],
      userId: "user-1",
      appBaseUrl: "https://media.example.com:8443/prefix",
    });
    expect(ctx.appBaseUrl).toBe("https://media.example.com:8443/prefix");
  });

  it("exposes the inert pool when no pool is provided", () => {
    const ctx = buildContext({
      pluginId: "trakt",
      allowedHosts: [],
      userId: null,
      appBaseUrl: "https://media.example.com",
    });
    expect(() => ctx.pool.markExhausted()).not.toThrow();
  });
});
