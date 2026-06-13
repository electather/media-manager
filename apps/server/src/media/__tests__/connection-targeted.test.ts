import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

// Row returned by the mocked query. Tests mutate `currentRow` per case.
interface ConnRow {
  id: string;
  userId: string;
  pluginId: string;
  enabled: number;
  isDefault: number;
  displayName: string | null;
  userConfig: string | null;
  encryptedCredentials: string | null;
  credentialsIv: string | null;
}

let currentRow: ConnRow | null = null;

vi.mock("../../db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ all: async () => (currentRow ? [currentRow] : []) }),
          get: async () => currentRow,
        }),
      }),
    }),
  }),
}));

vi.mock("../../db/schema/plugin-runtime/credentials", () => ({
  serviceConnections: {
    id: "id",
    userId: "userId",
    enabled: "enabled",
    isDefault: "isDefault",
    createdAt: "createdAt",
    pluginId: "pluginId",
  },
}));

// decryptField returns whatever the test stages — `null` is the missing-ciphertext case.
let decryptResult: unknown = { token: "valid" };
vi.mock("../../crypto/helpers", () => ({
  decryptField: async () => decryptResult,
}));

const invokeWithCredentialsMock = vi.fn(async (_args: { credentials: unknown }) => ({ ok: true }));
vi.mock("../../plugin-runtime", () => ({
  capabilityRegistry: { listProviders: () => ["seerr"] },
  pluginRuntime: {
    invokeWithCredentials: invokeWithCredentialsMock,
  },
}));

vi.mock("@nama/plugin-sdk", () => ({
  getCapability: () => ({ name: "mediaRequest" }),
}));

const { dispatchToConnection } = await import("../service/connection-targeted");
const { PluginCallError } = await import("../errors");

function makeRow(overrides: Partial<ConnRow> = {}): ConnRow {
  return {
    id: "conn-1",
    userId: "u1",
    pluginId: "seerr",
    enabled: 1,
    isDefault: 1,
    displayName: "Seerr",
    userConfig: null,
    encryptedCredentials: "enc",
    credentialsIv: "iv",
    ...overrides,
  };
}

beforeEach(() => {
  invokeWithCredentialsMock.mockClear();
  decryptResult = { token: "valid" };
  currentRow = makeRow();
});

describe("dispatchToConnection null-credentials guard (#450)", () => {
  it("throws mcp.target_not_found when decryptField returns null (missing ciphertext)", async () => {
    // A row with null iv/data decrypts to null. Without the guard, null
    // credentials would flow into invokeWithCredentials and the plugin would be
    // invoked unauthenticated.
    currentRow = makeRow({ encryptedCredentials: null, credentialsIv: null });
    decryptResult = null;

    await expect(
      dispatchToConnection({
        userId: "u1",
        connectionId: "conn-1",
        capability: "mediaRequest",
        version: "v1",
        method: "createRequest",
        input: {},
      }),
    ).rejects.toMatchObject({ code: "mcp.target_not_found" });

    // The plugin handler must never run with null credentials.
    expect(invokeWithCredentialsMock).not.toHaveBeenCalled();
  });

  it("invokes the plugin with decrypted credentials when ciphertext is present", async () => {
    decryptResult = { token: "valid" };

    const out = await dispatchToConnection({
      userId: "u1",
      connectionId: "conn-1",
      capability: "mediaRequest",
      version: "v1",
      method: "createRequest",
      input: {},
    });

    expect(out).toEqual({ ok: true });
    expect(invokeWithCredentialsMock).toHaveBeenCalledTimes(1);
    expect(invokeWithCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: { token: "valid" } }),
    );
  });

  // Reference so the formatter keeps the import.
  void PluginCallError;
});
