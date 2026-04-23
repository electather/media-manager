import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

// The service touches env, the plugin runtime, shared credentials, the cache
// dispatcher, and the drizzle-backed DB. We mock every boundary so the tests
// exercise only the stripping + merge semantics we care about for x-private.

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

// Drizzle operators are opaque in our mocks — we only need referential
// identity so the in-memory db can tell `serviceConnections` from `plugins`.
vi.mock("drizzle-orm", () => {
  const noop = () => ({});
  return {
    and: noop,
    desc: noop,
    eq: noop,
    lt: noop,
    ne: noop,
  };
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

// Keep encryption/decryption transparent so the tests can assert against
// the plaintext userConfig stored in the DB. Credentials still flow through
// the helper functions, but they're opaque to these tests.
vi.mock("../../crypto/vault", () => ({
  encrypt: async (plain: string) => `iv:${Buffer.from(plain).toString("base64")}`,
  decrypt: async (combined: string) => {
    const [, b64] = combined.split(":");
    return Buffer.from(b64 ?? "", "base64").toString();
  },
}));

const runAuthMock = vi.fn();
const testConnectionMock = vi.fn();

vi.mock("../../plugin-runtime/runtime", () => ({
  pluginRuntime: {
    runAuth: (...args: unknown[]) => runAuthMock(...args),
    testConnection: (...args: unknown[]) => testConnectionMock(...args),
  },
}));

vi.mock("../../plugin-runtime/registry", () => ({
  capabilityRegistry: {
    get: (id: string) => (state.plugins.some((p) => p.id === id) ? {} : undefined),
  },
}));

vi.mock("../../plugin-runtime/shared-credentials", () => ({
  sharedCredentialsService: {
    countEnabled: async () => 0,
  },
}));

vi.mock("../../media/dispatcher", () => ({
  invalidateUserCache: vi.fn(),
}));

// Import after all mocks are installed so the module binds to them.
const { connectionsService } = await import("../service");

const PRIVATE_PLUGIN_MANIFEST = {
  name: "Plex",
  version: "1.0.0",
  description: "",
  logoUrl: undefined,
  auth: { kind: "form" },
  capabilities: {
    library: { version: "v1", scope: "user" },
  },
  userConfigSchema: {
    type: "object",
    properties: {
      externalUrl: { type: "string", title: "External URL" },
      internalUrl: { type: "string", title: "Internal URL", "x-private": true },
      apiKey: { type: "string", title: "API Key", "x-secret": true },
      sessionToken: {
        type: "string",
        title: "Session token",
        "x-secret": true,
        "x-private": true,
      },
    },
  },
  credentialsSchema: { type: "object" },
  poolable: false,
};

function installPlugin() {
  state.plugins = [
    {
      id: "plex",
      enabled: 1,
      manifest: JSON.stringify(PRIVATE_PLUGIN_MANIFEST),
    },
  ];
}

function seedConnection(userConfig: unknown) {
  state.connections = [
    {
      id: "conn-1",
      userId: "user-1",
      pluginId: "plex",
      status: "connected",
      enabled: 1,
      isDefault: 1,
      displayName: "Home Plex",
      encryptedCredentials: Buffer.from(JSON.stringify({ token: "t" })).toString("base64"),
      credentialsIv: "iv",
      userConfig: JSON.stringify(userConfig),
      tokenExpiresAt: null,
      lastVerifiedAt: Date.now(),
      errorMessage: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ];
}

beforeEach(() => {
  state.connections = [];
  state.plugins = [];
  runAuthMock.mockReset();
  testConnectionMock.mockReset();
});

describe("connectionsService — x-private stripping", () => {
  it("omits x-private fields from listForUser responses", async () => {
    installPlugin();
    seedConnection({
      externalUrl: "https://plex.example.com",
      internalUrl: "http://192.168.1.10:32400",
      apiKey: "super-secret",
    });

    const list = await connectionsService.listForUser("user-1");
    expect(list).toHaveLength(1);
    const cfg = list[0]?.userConfig as Record<string, unknown>;
    expect(cfg.externalUrl).toBe("https://plex.example.com");
    expect(cfg).not.toHaveProperty("internalUrl");
    expect(cfg).not.toHaveProperty("apiKey");
  });

  it("omits x-private fields from getUserConfig responses", async () => {
    installPlugin();
    seedConnection({
      externalUrl: "https://plex.example.com",
      internalUrl: "http://192.168.1.10:32400",
      apiKey: "super-secret",
    });

    const cfg = (await connectionsService.getUserConfig("user-1", "conn-1")) as Record<
      string,
      unknown
    >;
    expect(cfg.externalUrl).toBe("https://plex.example.com");
    expect(cfg).not.toHaveProperty("internalUrl");
    expect(cfg).not.toHaveProperty("apiKey");
  });

  it("strips a field carrying both x-secret and x-private", async () => {
    installPlugin();
    seedConnection({
      externalUrl: "https://plex.example.com",
      sessionToken: "never-leak",
    });

    const cfg = (await connectionsService.getUserConfig("user-1", "conn-1")) as Record<
      string,
      unknown
    >;
    expect(cfg).toEqual({ externalUrl: "https://plex.example.com" });
  });

  it("preserves a stored x-private field when updateUserConfig omits it", async () => {
    installPlugin();
    seedConnection({
      externalUrl: "https://plex.example.com",
      internalUrl: "http://192.168.1.10:32400",
      apiKey: "super-secret",
    });
    runAuthMock.mockResolvedValue({ status: "completed", credentials: { token: "fresh" } });

    await connectionsService.updateUserConfig({
      userId: "user-1",
      connectionId: "conn-1",
      // The client sent back only the visible field. internalUrl (x-private)
      // and apiKey (x-secret) were stripped from the response it originally
      // received, so they are legitimately absent here.
      userConfig: { externalUrl: "https://new.example.com" },
    });

    const stored = JSON.parse(state.connections[0]!.userConfig!) as Record<string, unknown>;
    expect(stored).toEqual({
      externalUrl: "https://new.example.com",
      internalUrl: "http://192.168.1.10:32400",
      apiKey: "super-secret",
    });

    // After merging, getUserConfig must still hide the private + secret fields.
    const cfg = (await connectionsService.getUserConfig("user-1", "conn-1")) as Record<
      string,
      unknown
    >;
    expect(cfg).toEqual({ externalUrl: "https://new.example.com" });
  });

  it("allows updating an x-private field when the client sends a new value", async () => {
    installPlugin();
    seedConnection({
      externalUrl: "https://plex.example.com",
      internalUrl: "http://192.168.1.10:32400",
      apiKey: "super-secret",
    });
    runAuthMock.mockResolvedValue({ status: "completed", credentials: { token: "fresh" } });

    await connectionsService.updateUserConfig({
      userId: "user-1",
      connectionId: "conn-1",
      userConfig: {
        externalUrl: "https://plex.example.com",
        internalUrl: "http://10.0.0.5:32400",
      },
    });

    const stored = JSON.parse(state.connections[0]!.userConfig!) as Record<string, unknown>;
    expect(stored.internalUrl).toBe("http://10.0.0.5:32400");
    expect(stored.apiKey).toBe("super-secret");
  });
});
