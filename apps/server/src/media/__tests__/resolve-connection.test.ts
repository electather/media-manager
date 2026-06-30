import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { BUNDLED_CREDENTIAL_ID } from "../../plugin-runtime/internal/shared-credentials";

// Shared credentials (app/OAuth identities) only for `global` scope, never `user`.
// Using for user-scoped requests = guaranteed auth failure → all_failed instead of clean drop (#503).

const queryEnabledConnectionsForPluginMock = vi.fn();
const decryptFieldMock = vi.fn();
const listDecryptedActiveMock = vi.fn();

vi.mock("../../db/client", () => ({ getDb: () => ({}) }));
vi.mock("../../db/queries", async (importActual) => {
  // Re-use the real parseUserConfig so this integration test never drifts from
  // the helper's edge-case behavior (its own contract is unit-tested in
  // db/__tests__/parse-user-config.test.ts). `db/client` is mocked above, so
  // importing the real module does not pull in env validation.
  const actual = await importActual<typeof import("../../db/queries")>();
  return {
    parseUserConfig: actual.parseUserConfig,
    queryEnabledConnectionsForPlugin: (...args: unknown[]) =>
      queryEnabledConnectionsForPluginMock(...args),
  };
});
vi.mock("../../crypto/helpers", () => ({
  decryptField: (...args: unknown[]) => decryptFieldMock(...args),
}));
vi.mock("../../plugin-runtime", () => ({
  sharedCredentialsService: {
    listDecryptedActive: (...args: unknown[]) => listDecryptedActiveMock(...args),
  },
}));

const { resolveConnections } = await import("../internal/resolve-connection");

function userRow(pluginId: string) {
  return {
    pluginId,
    id: `${pluginId}-conn-1`,
    isDefault: 1,
    credentialsIv: "iv",
    encryptedCredentials: "enc",
    userConfig: null,
  };
}

beforeEach(() => {
  queryEnabledConnectionsForPluginMock.mockReset();
  decryptFieldMock.mockReset();
  listDecryptedActiveMock.mockReset();
  decryptFieldMock.mockResolvedValue({ accessToken: "user-token" });
});

describe("resolveConnections", () => {
  it("skips the shared-credential fallback for user-scoped requests", async () => {
    queryEnabledConnectionsForPluginMock.mockResolvedValue([]);
    listDecryptedActiveMock.mockResolvedValue([{ value: { clientId: "admin-id" } }]);

    const conns = await resolveConnections("user-1", "trakt", "user");

    // No user connection + user scope => empty, even though admin shared creds
    // exist. The dispatcher then sees attempted=0 and drops the row cleanly
    // instead of 503-ing on a guaranteed 401.
    expect(conns).toEqual([]);
    expect(listDecryptedActiveMock).not.toHaveBeenCalled();
  });

  it("uses the shared-credential fallback for global-scoped requests", async () => {
    queryEnabledConnectionsForPluginMock.mockResolvedValue([]);
    listDecryptedActiveMock.mockResolvedValue([{ value: { apiKey: "admin-key" } }]);

    const conns = await resolveConnections("user-1", "tmdb", "global");

    expect(conns).toEqual([
      {
        kind: "shared",
        pluginId: "tmdb",
        connectionId: null,
        credentials: { apiKey: "admin-key" },
        userConfig: null,
      },
    ]);
  });

  it("returns user connections without consulting shared creds, regardless of scope", async () => {
    queryEnabledConnectionsForPluginMock.mockResolvedValue([userRow("trakt")]);

    const conns = await resolveConnections("user-1", "trakt", "user");

    expect(conns).toEqual([
      {
        kind: "user",
        pluginId: "trakt",
        connectionId: "trakt-conn-1",
        isDefault: true,
        credentials: { accessToken: "user-token" },
        userConfig: null,
      },
    ]);
    expect(listDecryptedActiveMock).not.toHaveBeenCalled();
  });

  it("returns empty for a global request when no user connection and no shared creds exist", async () => {
    queryEnabledConnectionsForPluginMock.mockResolvedValue([]);
    listDecryptedActiveMock.mockResolvedValue([]);

    const conns = await resolveConnections("user-1", "tmdb", "global");

    expect(conns).toEqual([]);
  });

  it("prefers a real shared credential over the bundled default", async () => {
    // WHY: listDecryptedActive appends the bundled default last; this 2nd consumer
    // takes shared[0], so a real admin key must win over the bundled fallback.
    queryEnabledConnectionsForPluginMock.mockResolvedValue([]);
    listDecryptedActiveMock.mockResolvedValue([
      { id: "real", value: { apiKey: "admin-key" } },
      { id: BUNDLED_CREDENTIAL_ID, value: { apiKey: "bundled-key" } },
    ]);

    const conns = await resolveConnections("user-1", "tmdb", "global");

    expect(conns[0]?.credentials).toEqual({ apiKey: "admin-key" });
  });
});
