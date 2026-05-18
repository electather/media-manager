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
  return { ...actual, pluginRuntime: { runAuth, getModule } };
});

const writeConnection = vi.fn();
vi.mock("../helpers", async () => {
  const actual = await vi.importActual<typeof import("../helpers")>("../helpers");
  return { ...actual, writeConnection };
});

// Stub the db layer so tests control what DELETE...RETURNING returns.
const mockDelete = vi.fn();
const mockWhere = vi.fn();
const mockReturning = vi.fn();
vi.mock("../../db/client", () => ({
  getDb: () => ({
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            nonce: "nonce-1",
            userId: "user-1",
            pluginId: "trakt",
            state: "encrypted-state",
            stateIv: "iv",
            createdAt: Date.now() - 1000,
            expiresAt: Date.now() + 60_000,
          }),
        }),
      }),
    }),
    delete: mockDelete,
  }),
}));

// Stub encryptJson / decryptJson so the test doesn't need real crypto.
vi.mock("../helpers", async () => {
  const actual = await vi.importActual<typeof import("../helpers")>("../helpers");
  return {
    ...actual,
    writeConnection,
    encryptJson: vi.fn().mockResolvedValue({ data: "enc", iv: "iv" }),
    decryptJson: vi.fn().mockResolvedValue({ token: "tok" }),
  };
});

const { completeRedirectAuth, pollDeviceAuth } = await import("../auth");

/** Returns a chainable query builder stub whose .returning() resolves to rows. */
function makeDeleteChain(rows: Array<{ nonce: string }>) {
  const chain = {
    where: vi.fn(),
    returning: vi.fn().mockResolvedValue(rows),
  };
  chain.where.mockReturnValue(chain);
  return chain;
}

describe("writeAndCleanupPendingAuth — concurrent nonce consumption", () => {
  beforeEach(() => {
    runAuth.mockReset();
    writeConnection.mockReset();
    mockDelete.mockReset();
    mockWhere.mockReset();
    mockReturning.mockReset();
  });

  describe("completeRedirectAuth", () => {
    it("throws oauth.concurrent_completion when DELETE...RETURNING returns no rows", async () => {
      // The nonce was already consumed by a concurrent completeRedirectAuth call;
      // DELETE returns no rows. The function must throw rather than writing a
      // duplicate connection row.
      mockDelete.mockReturnValue(makeDeleteChain([]));

      runAuth.mockResolvedValueOnce({
        status: "completed",
        credentials: { accessToken: "tok" },
        userConfigPatch: undefined,
      });

      await expect(
        completeRedirectAuth({
          userId: "user-1",
          nonce: "nonce-1",
          queryParams: { code: "abc" },
        }),
      ).rejects.toMatchObject({ code: "oauth.concurrent_completion" });

      // Confirm writeConnection was never called — no duplicate row.
      expect(writeConnection).not.toHaveBeenCalled();
    });

    it("returns connectionId when DELETE...RETURNING succeeds (nonce consumed first)", async () => {
      // Normal path: this call wins the race and gets the nonce.
      mockDelete.mockReturnValue(makeDeleteChain([{ nonce: "nonce-1" }]));

      runAuth.mockResolvedValueOnce({
        status: "completed",
        credentials: { accessToken: "tok" },
        userConfigPatch: undefined,
      });
      writeConnection.mockResolvedValueOnce("conn-1");

      const result = await completeRedirectAuth({
        userId: "user-1",
        nonce: "nonce-1",
        queryParams: { code: "abc" },
      });

      expect(result).toEqual({ connectionId: "conn-1" });
      expect(writeConnection).toHaveBeenCalledOnce();
    });
  });

  describe("pollDeviceAuth", () => {
    it("returns status:error when DELETE...RETURNING returns no rows", async () => {
      // A concurrent poll already consumed the nonce; this call must not write
      // a second connection row.
      mockDelete.mockReturnValue(makeDeleteChain([]));

      runAuth.mockResolvedValueOnce({
        status: "completed",
        credentials: { accessToken: "tok" },
        userConfigPatch: undefined,
      });

      const result = await pollDeviceAuth({ userId: "user-1", nonce: "nonce-1" });

      expect(result).toEqual({
        status: "error",
        message: "auth nonce already consumed by a concurrent request",
      });
      expect(writeConnection).not.toHaveBeenCalled();
    });

    it("returns status:completed when DELETE...RETURNING succeeds", async () => {
      mockDelete.mockReturnValue(makeDeleteChain([{ nonce: "nonce-1" }]));

      runAuth.mockResolvedValueOnce({
        status: "completed",
        credentials: { accessToken: "tok" },
        userConfigPatch: undefined,
      });
      writeConnection.mockResolvedValueOnce("conn-2");

      const result = await pollDeviceAuth({ userId: "user-1", nonce: "nonce-1" });

      expect(result).toEqual({ status: "completed", connectionId: "conn-2" });
      expect(writeConnection).toHaveBeenCalledOnce();
    });
  });
});
