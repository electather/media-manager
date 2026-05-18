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

const { createFormConnection } = await import("../auth");

describe("createFormConnection — no-auth plugins (manifest.auth.kind === 'none')", () => {
  beforeEach(() => {
    runAuth.mockReset();
    getModule.mockReset();
    writeConnection.mockReset();
  });

  it("skips startAuth and moves x-secret fields into the encrypted credentials blob", async () => {
    // Regression: notification plugins like Telegram declare auth.kind: "none"
    // and export no startAuth. The prior implementation always called runAuth,
    // which surfaced "plugin telegram does not export startAuth" to the user.
    // Security: x-secret fields must land in the encrypted credentials column,
    // not the plaintext userConfig column.
    getModule.mockResolvedValueOnce({
      manifest: {
        auth: { kind: "none" },
        userConfigSchema: {
          type: "object",
          properties: {
            botToken: { type: "string", title: "Bot token", "x-secret": true },
            chatId: { type: "string", title: "Chat ID" },
          },
          required: ["botToken", "chatId"],
        },
      },
    });
    writeConnection.mockResolvedValueOnce("conn-1");

    const result = await createFormConnection({
      userId: "user-1",
      pluginId: "telegram",
      userConfig: { botToken: "123:abc", chatId: "456" },
    });

    expect(result).toEqual({ id: "conn-1" });
    expect(runAuth).not.toHaveBeenCalled();
    expect(writeConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        pluginId: "telegram",
        // x-secret botToken goes to the encrypted credentials blob.
        credentials: { botToken: "123:abc" },
        // Plaintext userConfig only holds non-secret fields.
        userConfig: { chatId: "456" },
        allowEmptyCredentials: true,
      }),
    );
  });

  it("collapses userConfig to {} when every field is x-secret", async () => {
    // Exercises the `allowEmptyCredentials` path end-to-end: when the entire
    // schema is x-secret, the plaintext column ends up empty and the
    // encrypted credentials blob carries every submitted field.
    getModule.mockResolvedValueOnce({
      manifest: {
        auth: { kind: "none" },
        userConfigSchema: {
          type: "object",
          properties: {
            botToken: { type: "string", "x-secret": true },
            apiKey: { type: "string", "x-secret": true },
          },
          required: ["botToken", "apiKey"],
        },
      },
    });
    writeConnection.mockResolvedValueOnce("conn-2");

    await createFormConnection({
      userId: "user-1",
      pluginId: "all-secret",
      userConfig: { botToken: "t", apiKey: "k" },
    });

    expect(writeConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { botToken: "t", apiKey: "k" },
        userConfig: {},
        allowEmptyCredentials: true,
      }),
    );
  });

  it("still surfaces blank required fields before persisting", async () => {
    getModule.mockResolvedValueOnce({
      manifest: {
        auth: { kind: "none" },
        userConfigSchema: {
          type: "object",
          properties: {
            botToken: { type: "string" },
            chatId: { type: "string" },
          },
          required: ["botToken", "chatId"],
        },
      },
    });

    await expect(
      createFormConnection({
        userId: "user-1",
        pluginId: "telegram",
        userConfig: { botToken: "", chatId: "456" },
      }),
    ).rejects.toMatchObject({ code: "plugin.credentials_empty" });
    expect(writeConnection).not.toHaveBeenCalled();
    expect(runAuth).not.toHaveBeenCalled();
  });

  it("rejects malformed x-allowed-host fields before persisting", async () => {
    getModule.mockResolvedValueOnce({
      manifest: {
        auth: { kind: "none" },
        userConfigSchema: {
          type: "object",
          properties: {
            serverUrl: { type: "string", "x-allowed-host": true },
          },
          required: ["serverUrl"],
        },
      },
    });
    writeConnection.mockResolvedValueOnce("conn-1");

    // `params.field` is the routing contract the modal reads to mark the
    // offending input — assert it explicitly so a refactor that drops the
    // hint fails this test instead of silently breaking field attribution.
    await expect(
      createFormConnection({
        userId: "user-1",
        pluginId: "custom-webhook",
        userConfig: { serverUrl: "not-a-url" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "plugin.invalid_base_url",
      params: { field: "serverUrl" },
    });
    expect(writeConnection).not.toHaveBeenCalled();
    expect(runAuth).not.toHaveBeenCalled();
  });
});
