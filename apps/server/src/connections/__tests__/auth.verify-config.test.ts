import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

const runAuth = vi.fn();
const getModule = vi.fn();
vi.mock("../../plugin-runtime", async () => {
  const actual =
    await vi.importActual<typeof import("../../plugin-runtime")>("../../plugin-runtime");
  return {
    ...actual,
    pluginRuntime: { runAuth, getModule },
  };
});

const writeConnection = vi.fn();
vi.mock("../helpers", async () => {
  const actual = await vi.importActual<typeof import("../helpers")>("../helpers");
  return { ...actual, writeConnection };
});

const { verifyConfig } = await import("../auth");

describe("verifyConfig — x-plugin-resolved field stripping", () => {
  beforeEach(() => {
    runAuth.mockReset();
    getModule.mockReset();
    writeConnection.mockReset();
  });

  it("strips x-plugin-resolved fields before passing userConfig to startAuth", async () => {
    // Regression: clients could spoof plugin-managed fields (e.g. Jellyfin's
    // userId) by submitting them in the verifyConfig payload. The create-connection
    // path strips these via stripRequestFields; verifyConfig must do the same.
    getModule.mockResolvedValueOnce({
      manifest: {
        auth: { kind: "form" },
        userConfigSchema: {
          type: "object",
          properties: {
            serverUrl: { type: "string", title: "Server URL" },
            userId: { type: "string", "x-plugin-resolved": true },
          },
          required: ["serverUrl"],
        },
      },
    });
    runAuth.mockResolvedValueOnce({ status: "completed" });

    await verifyConfig({
      userId: "user-1",
      pluginId: "jellyfin",
      userConfig: { serverUrl: "http://jellyfin.local", userId: "spoofed-user-id" },
    });

    // startAuth must receive userConfig without the x-plugin-resolved field.
    expect(runAuth).toHaveBeenCalledWith("jellyfin", "startAuth", "user-1", {
      serverUrl: "http://jellyfin.local",
    });
  });

  it("returns ok: true when startAuth completes successfully", async () => {
    getModule.mockResolvedValueOnce({
      manifest: {
        auth: { kind: "form" },
        userConfigSchema: {
          type: "object",
          properties: {
            serverUrl: { type: "string" },
          },
          required: ["serverUrl"],
        },
      },
    });
    runAuth.mockResolvedValueOnce({ status: "completed" });

    const result = await verifyConfig({
      userId: "user-1",
      pluginId: "jellyfin",
      userConfig: { serverUrl: "http://jellyfin.local" },
    });

    expect(result).toEqual({ ok: true });
  });
});
