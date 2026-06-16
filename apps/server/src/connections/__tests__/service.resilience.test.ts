import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

// Tests for two correctness findings from issue #595:
//   1. Corrupt userConfig rows must degrade gracefully instead of throwing 500s.
//   2. updateDisplayName must reject missing/foreign ids and must invalidate cache.

vi.mock("../../env", () => ({
  env: { ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" },
}));

interface ConnectionRow {
  id: string;
  userId: string;
  pluginId: string;
  status: string;
  enabled: number;
  isDefault: number;
  displayName: string | null;
  encryptedCredentials: string;
  credentialsIv: string;
  userConfig: string | null;
  tokenExpiresAt: number | null;
  lastVerifiedAt: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

interface PluginRow {
  id: string;
  manifest: string;
  enabled: number;
}

const state: {
  connections: ConnectionRow[];
  plugins: PluginRow[];
} = { connections: [], plugins: [] };

// Drizzle operators are opaque in these mocks — only referential identity is needed.
vi.mock("drizzle-orm", () => {
  const noop = () => ({});
  return { and: noop, desc: noop, eq: noop, lt: noop, ne: noop };
});

vi.mock("../../db/schema", () => ({
  serviceConnections: { __table: "serviceConnections" },
  plugins: { __table: "plugins" },
  pendingAuth: { __table: "pendingAuth" },
}));

vi.mock("../../db/client", () => {
  function rowsFor(table: unknown): unknown[] {
    const name = (table as { __table?: string })?.__table;
    if (name === "serviceConnections") return state.connections;
    if (name === "plugins") return state.plugins;
    return [];
  }

  // The where() predicate is ignored — the full rowset is returned. These tests
  // exercise parse-error resilience and mutation guard semantics, not auth
  // predicates. Two consequences a future author must keep in mind:
  //   - The `connection.not_found` assertions pass because `state.connections`
  //     is empty after beforeEach, NOT because the WHERE was evaluated. Seeding a
  //     row with a different id before a 404 assertion would make the mock return
  //     it and the test would pass for the wrong reason.
  //   - The foreign-connection case (row exists but belongs to another user)
  //     cannot be exercised here. `requireConnection`'s ownership predicate is
  //     covered by its own tests against the real DB.
  const dbMock = {
    select() {
      return {
        from(table: unknown) {
          return {
            where(_: unknown) {
              return {
                async get() {
                  return rowsFor(table)[0];
                },
                async all() {
                  return rowsFor(table);
                },
                orderBy() {
                  return {
                    async get() {
                      return rowsFor(table)[0];
                    },
                    async all() {
                      return rowsFor(table);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    insert(_table: unknown) {
      return {
        async values(row: ConnectionRow) {
          state.connections.push(row);
        },
      };
    },
    update(table: unknown) {
      return {
        set(patch: Partial<ConnectionRow>) {
          return {
            where(_: unknown) {
              const rows = rowsFor(table) as ConnectionRow[];
              for (const row of rows) Object.assign(row, patch);
              return Promise.resolve(undefined);
            },
          };
        },
      };
    },
    delete(_table: unknown) {
      return {
        where(_: unknown) {
          return Promise.resolve(undefined);
        },
      };
    },
  };

  return { getDb: () => dbMock };
});

vi.mock("../../crypto/vault", () => ({
  encrypt: async (plain: string) => `iv:${Buffer.from(plain).toString("base64")}`,
  decrypt: async (combined: string) => {
    const [, b64] = combined.split(":");
    return Buffer.from(b64 ?? "", "base64").toString();
  },
}));

const invalidateUserCacheMock = vi.fn();

vi.mock("../../plugin-runtime", () => ({
  pluginRuntime: {
    runAuth: vi.fn(),
    testConnection: vi.fn(),
  },
  capabilityRegistry: {
    get: (id: string) => (state.plugins.some((p) => p.id === id) ? {} : undefined),
  },
  sharedCredentialsService: { countEnabled: async () => 0 },
}));

vi.mock("../../media", () => ({
  invalidateUserCache: (...args: unknown[]) => invalidateUserCacheMock(...args),
}));

const { connectionsService } = await import("../service");

const SIMPLE_MANIFEST = {
  name: "TestPlugin",
  version: "1.0.0",
  description: "",
  logoUrl: undefined,
  auth: { kind: "form" },
  capabilities: { library: { version: "v1", scope: "user" } },
  userConfigSchema: {
    type: "object",
    properties: {
      url: { type: "string", title: "URL" },
    },
  },
  credentialsSchema: { type: "object" },
  poolable: false,
};

function installPlugin() {
  state.plugins = [{ id: "test-plugin", enabled: 1, manifest: JSON.stringify(SIMPLE_MANIFEST) }];
}

function seedConnection(opts: { id?: string; userConfig?: string | null } = {}) {
  const row: ConnectionRow = {
    id: opts.id ?? "conn-1",
    userId: "user-1",
    pluginId: "test-plugin",
    status: "connected",
    enabled: 1,
    isDefault: 1,
    displayName: "My Connection",
    encryptedCredentials: Buffer.from(JSON.stringify({ token: "t" })).toString("base64"),
    credentialsIv: "iv",
    userConfig:
      opts.userConfig !== undefined
        ? opts.userConfig
        : JSON.stringify({ url: "https://example.com" }),
    tokenExpiresAt: null,
    lastVerifiedAt: Date.now(),
    errorMessage: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.connections = [row];
}

beforeEach(() => {
  state.connections = [];
  state.plugins = [];
  invalidateUserCacheMock.mockReset();
});

describe("corrupt userConfig resilience (finding 1)", () => {
  it("includes the connection in listForUser even when userConfig is malformed instead of throwing 500", async () => {
    // A single malformed row must not break the whole list. The corrupt blob
    // degrades to null — the row is still returned with display fields computed
    // from an empty config rather than propagating a raw SyntaxError as a 500.
    installPlugin();
    seedConnection({ userConfig: "{not valid json" });

    const list = await connectionsService.listForUser("user-1");
    expect(list).toHaveLength(1);
    // With userConfig null the URL field renders as an empty string (no data to show).
    const urlField = list[0]?.displayFields.find((f) => f.label === "URL");
    expect(urlField?.value).toBe("");
  });

  it("returns null userConfig from getUserConfig when the stored blob is malformed", async () => {
    // Without a parseable userConfig the caller gets null back (no x-private
    // leakage risk since there are no fields to strip) rather than a 500.
    installPlugin();
    seedConnection({ userConfig: "not-json-at-all" });

    const result = await connectionsService.getUserConfig("user-1", "conn-1");
    expect(result).toBeNull();
  });
});

describe("updateDisplayName guard (finding 2)", () => {
  it("throws connection.not_found when no connection exists", async () => {
    // DO NOT seed state.connections before this assertion: the db mock ignores
    // the WHERE predicate, so the guard fires here only because the rowset is
    // empty. Seeding any row would make the mock return it and bypass the guard,
    // silently turning this into a false pass.
    installPlugin();

    await expect(
      connectionsService.updateDisplayName({
        userId: "user-1",
        connectionId: "missing",
        displayName: "New Name",
      }),
    ).rejects.toMatchObject({ status: 404, code: "connection.not_found" });
  });

  it("invalidates the user cache after a successful rename", async () => {
    // The display name is cached in the connections list; callers need an
    // up-to-date view after the rename so the cache must be invalidated.
    installPlugin();
    seedConnection();

    await connectionsService.updateDisplayName({
      userId: "user-1",
      connectionId: "conn-1",
      displayName: "Renamed",
    });

    expect(invalidateUserCacheMock).toHaveBeenCalledWith("user-1");
  });
});
