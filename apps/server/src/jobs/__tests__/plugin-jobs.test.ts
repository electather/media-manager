import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { PluginError } from "@ent-mcp/plugin-sdk";

interface SetValues {
  status?: string;
  errorMessage?: string | null;
  encryptedCredentials?: string;
  credentialsIv?: string;
  updatedAt?: number;
}

const setCalls: SetValues[] = [];

const emitMock = vi.fn<(name: string, schema: unknown, payload: unknown) => Promise<void>>(
  async () => undefined,
);

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../db/client", () => ({
  getDb: () => ({
    update: () => ({
      set: (values: SetValues) => {
        setCalls.push(values);
        return { where: async () => undefined };
      },
    }),
  }),
}));

vi.mock("../../db/schema", () => ({
  serviceConnections: { id: "id" },
}));

vi.mock("../../crypto/helpers", () => ({
  decryptJson: async () => ({ token: "stale" }),
  encryptJson: async (value: unknown) => ({ iv: "iv", data: JSON.stringify(value) }),
}));

vi.mock("../../plugin-runtime", () => ({
  capabilityRegistry: {},
  pluginRuntime: {
    buildJobContext: async () => ({ user: null, credentials: {}, userConfig: null }),
  },
}));

vi.mock("../events", () => ({
  emit: emitMock,
}));

const { invokePerConnectionHandler } = await import("../plugin-jobs");

interface TestJob {
  pluginId: string;
  pluginName: string;
  id: string;
  schedule: string;
  handler: string;
  perConnection: boolean;
}

function makeJob(pluginId = "trakt"): TestJob {
  return {
    pluginId,
    pluginName: pluginId,
    id: "refresh-tokens",
    schedule: "0 * * * *",
    handler: "refreshTokens",
    perConnection: true,
  };
}

interface TestRow {
  id: string;
  userId: string;
  pluginId: string;
  userConfig: string | null;
  encryptedCredentials: string | null;
  credentialsIv: string | null;
}

function makeRow(id = "conn-1"): TestRow {
  return {
    id,
    userId: "user-1",
    pluginId: "trakt",
    userConfig: null,
    encryptedCredentials: "enc",
    credentialsIv: "iv",
  };
}

beforeEach(() => {
  setCalls.length = 0;
  emitMock.mockClear();
});

describe("invokePerConnectionHandler", () => {
  it("marks status 'expired' and emits auth-expired when handler throws plugin.token_expired", async () => {
    const job = makeJob();
    const row = makeRow("conn-42");
    const handler = async () => {
      throw new PluginError("plugin.token_expired", "refresh revoked");
    };

    await expect(invokePerConnectionHandler({ job, row, handler })).rejects.toThrow(
      "refresh revoked",
    );

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.status).toBe("expired");
    expect(setCalls[0]?.errorMessage).toBe("refresh revoked");

    expect(emitMock).toHaveBeenCalledTimes(1);
    const [name, , payload] = emitMock.mock.calls[0]!;
    expect(name).toBe("media.connection.auth-expired");
    expect(payload).toEqual({
      connectionId: "conn-42",
      pluginId: "trakt",
      userId: "user-1",
    });
  });

  it("marks status 'error' and does not emit when handler throws a generic error", async () => {
    const job = makeJob();
    const row = makeRow();
    const handler = async () => {
      throw new Error("network blew up");
    };

    await expect(invokePerConnectionHandler({ job, row, handler })).rejects.toThrow(
      "network blew up",
    );

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.status).toBe("error");
    expect(setCalls[0]?.errorMessage).toBe("network blew up");
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("does not propagate an emit failure to the caller", async () => {
    const job = makeJob();
    const row = makeRow();
    const handler = async () => {
      throw new PluginError("plugin.token_expired", "refresh revoked");
    };
    emitMock.mockRejectedValueOnce(new Error("emit boom"));

    await expect(invokePerConnectionHandler({ job, row, handler })).rejects.toThrow(
      "refresh revoked",
    );
  });

  it("persists refreshed credentials on a successful handler return", async () => {
    const job = makeJob();
    const row = makeRow("conn-9");
    const handler = async () => ({ token: "fresh" });

    await invokePerConnectionHandler({ job, row, handler });

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.encryptedCredentials).toBe(JSON.stringify({ token: "fresh" }));
    expect(setCalls[0]?.credentialsIv).toBe("iv");
    expect(setCalls[0]?.status).toBeUndefined();
    expect(emitMock).not.toHaveBeenCalled();
  });
});
