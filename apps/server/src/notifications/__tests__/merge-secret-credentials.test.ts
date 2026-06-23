import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

const { mergeSecretCredentials } = await import("../internal/deliver-handler");

// Regression: no-auth plugins (e.g. Telegram) declare x-secret fields like `botToken`. Connection create lifts these into encrypted credentials blob, but deliver() reads from args.channelConfig. Delivery job must merge decrypted credentials into channelConfig before invoke, else every notification fails with missing token.
describe("mergeSecretCredentials", () => {
  it("merges credential fields into channelConfig", () => {
    const merged = mergeSecretCredentials({ chatId: "456" }, { botToken: "tkn" });
    expect(merged).toEqual({ chatId: "456", botToken: "tkn" });
  });

  it("credentials override colliding channelConfig keys", () => {
    // Encrypted-at-rest value is the source of truth — a stale plaintext copy
    // must not silently shadow a freshly-rotated credential.
    const merged = mergeSecretCredentials(
      { botToken: "stale", chatId: "456" },
      { botToken: "fresh" },
    );
    expect(merged).toEqual({ botToken: "fresh", chatId: "456" });
  });

  it("returns channelConfig unchanged when credentials is null", () => {
    expect(mergeSecretCredentials({ chatId: "456" }, null)).toEqual({ chatId: "456" });
  });

  it("returns channelConfig unchanged when credentials is a non-object sentinel", () => {
    // Inbox stores `{ kind: "inbox" }` as a placeholder; a future change that
    // swaps it for a string must not corrupt channelConfig either.
    expect(mergeSecretCredentials({ chatId: "456" }, "opaque")).toEqual({ chatId: "456" });
    expect(mergeSecretCredentials({ chatId: "456" }, 42)).toEqual({ chatId: "456" });
  });

  it("uses {} as the base when channelConfig is null/undefined", () => {
    // Connections created with an all-x-secret schema have empty userConfig.
    expect(mergeSecretCredentials(null, { botToken: "tkn" })).toEqual({ botToken: "tkn" });
    expect(mergeSecretCredentials(undefined, { botToken: "tkn" })).toEqual({ botToken: "tkn" });
  });

  it("ignores array credentials (must be an object payload)", () => {
    expect(mergeSecretCredentials({ chatId: "456" }, ["tkn"])).toEqual({ chatId: "456" });
  });
});
