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

const { verifyConfig } = await import("../auth");

describe("verifyConfig — x-plugin-resolved field stripping", () => {
  beforeEach(() => {
    runAuth.mockReset();
    getModule.mockReset();
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

describe("verifyConfig — error paths", () => {
  const formManifest = {
    manifest: {
      auth: { kind: "form" },
      userConfigSchema: {
        type: "object",
        properties: { serverUrl: { type: "string" } },
        required: ["serverUrl"],
      },
    },
  } as const;

  beforeEach(() => {
    runAuth.mockReset();
    getModule.mockReset();
  });

  it("returns ok: false with message and field on generic auth error", async () => {
    getModule.mockResolvedValueOnce(formManifest);
    runAuth.mockResolvedValueOnce({
      status: "error",
      code: "plugin.credentials_invalid",
      devMessage: "bad credentials",
      params: { field: "serverUrl" },
    });

    const result = await verifyConfig({
      userId: "user-1",
      pluginId: "jellyfin",
      userConfig: { serverUrl: "http://jellyfin.local" },
    });

    expect(result).toEqual({ ok: false, message: "bad credentials", field: "serverUrl" });
  });

  it("throws plugin.invalid_base_url badRequest when startAuth surfaces that code", async () => {
    // Asserts the modal-routing contract: the typed error reaches the client
    // with `params.field` so the offending input can be highlighted. A refactor
    // that drops the rethrow would silently degrade this to `{ ok: false }`.
    getModule.mockResolvedValueOnce(formManifest);
    runAuth.mockResolvedValueOnce({
      status: "error",
      code: "plugin.invalid_base_url",
      devMessage: "unreachable host",
      params: { field: "serverUrl" },
    });

    await expect(
      verifyConfig({
        userId: "user-1",
        pluginId: "jellyfin",
        userConfig: { serverUrl: "http://bogus.local" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "plugin.invalid_base_url",
      params: { field: "serverUrl" },
    });
  });

  it("returns ok: false with 'unexpected status' when startAuth returns a non-terminal status", async () => {
    getModule.mockResolvedValueOnce(formManifest);
    runAuth.mockResolvedValueOnce({ status: "redirect", url: "https://example/", state: {} });

    const result = await verifyConfig({
      userId: "user-1",
      pluginId: "jellyfin",
      userConfig: { serverUrl: "http://jellyfin.local" },
    });

    expect(result).toEqual({ ok: false, message: "unexpected status: redirect" });
  });

  it("returns ok: false with the error message when startAuth throws a non-HTTP error", async () => {
    getModule.mockResolvedValueOnce(formManifest);
    runAuth.mockRejectedValueOnce(new Error("network down"));

    const result = await verifyConfig({
      userId: "user-1",
      pluginId: "jellyfin",
      userConfig: { serverUrl: "http://jellyfin.local" },
    });

    expect(result).toEqual({ ok: false, message: "network down" });
  });
});
