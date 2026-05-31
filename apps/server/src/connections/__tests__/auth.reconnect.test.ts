import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

// Regression coverage for the Reconnect bug: re-running the OAuth ceremony for
// a broken connection must REBIND credentials to the existing row, not insert a
// duplicate. Non-poolable plugins (Trakt, Plex) hold one row per user, so a
// second row would orphan the original's id / isDefault / displayName. We mock
// every boundary (db, crypto, plugin runtime, cache) and exercise the real
// `persistConnectionFromAuth` decision through `pollDeviceAuth` /
// `completeRedirectAuth`.

vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
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

interface PendingRow {
  nonce: string;
  userId: string;
  pluginId: string;
  state: string;
  stateIv: string;
  createdAt: number;
  expiresAt: number;
}

const state: {
  connections: ConnectionRow[];
  pending: PendingRow | undefined;
  inserts: number;
} = { connections: [], pending: undefined, inserts: 0 };

// Drizzle operators are opaque in our mocks — collapse them to noops so query
// construction doesn't touch the (column-less) mock tables.
vi.mock("drizzle-orm", () => {
  const noop = () => ({});
  return { and: noop, desc: noop, eq: noop, lt: noop, ne: noop, notExists: noop };
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
    if (name === "pendingAuth") return state.pending ? [state.pending] : [];
    return [];
  }

  // The WHERE predicate is ignored — these tests are scoped to insert-vs-update
  // routing, not authorization filters. `serviceConnections` reads go through
  // `.orderBy().get()` (findConnectionForPlugin); the pending-auth read uses a
  // plain `.where().get()`.
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
          state.inserts += 1;
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
          // `consumeAndWritePendingAuth` uses DELETE ... RETURNING. The
          // error/expired branches issue a bare `await DELETE`, which the
          // completed-path tests never reach — awaiting this non-thenable
          // object there is harmless.
          return {
            returning: async () => {
              const consumed = state.pending ? [{ nonce: state.pending.nonce }] : [];
              state.pending = undefined;
              return consumed;
            },
          };
        },
      };
    },
  };

  return { getDb: () => dbMock };
});

// Transparent crypto so the test can assert against plaintext credentials.
vi.mock("../../crypto/vault", () => ({
  encrypt: async (plain: string) => `iv:${Buffer.from(plain).toString("base64")}`,
  decrypt: async (combined: string) => {
    const [, b64] = combined.split(":");
    return Buffer.from(b64 ?? "", "base64").toString();
  },
}));

const runAuth = vi.fn();
const getModule = vi.fn();
vi.mock("../../plugin-runtime", () => ({
  pluginRuntime: {
    runAuth: (...args: unknown[]) => runAuth(...args),
    getModule: (...args: unknown[]) => getModule(...args),
  },
  resolveAllowedHostsFromSchema: () => undefined,
}));

const invalidateUserCache = vi.fn();
vi.mock("../../media", () => ({ invalidateUserCache }));

const { pollDeviceAuth, completeRedirectAuth } = await import("../auth");

function decryptCreds(row: ConnectionRow): unknown {
  return JSON.parse(Buffer.from(row.encryptedCredentials, "base64").toString());
}

function seedPending() {
  state.pending = {
    nonce: "nonce-1",
    userId: "user-1",
    pluginId: "trakt",
    state: Buffer.from(JSON.stringify({ device: "poll" })).toString("base64"),
    stateIv: "iv",
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() + 60_000,
  };
}

function seedBrokenConnection() {
  state.connections = [
    {
      id: "conn-1",
      userId: "user-1",
      pluginId: "trakt",
      status: "expired",
      enabled: 1,
      isDefault: 1,
      displayName: "My Trakt",
      encryptedCredentials: Buffer.from(JSON.stringify({ accessToken: "stale" })).toString(
        "base64",
      ),
      credentialsIv: "iv",
      userConfig: JSON.stringify({ slug: "keep-me" }),
      tokenExpiresAt: Date.now() - 1000,
      lastVerifiedAt: Date.now() - 99_999,
      errorMessage: "token expired",
      createdAt: Date.now() - 100_000,
      updatedAt: Date.now() - 100_000,
    },
  ];
}

beforeEach(() => {
  state.connections = [];
  state.pending = undefined;
  state.inserts = 0;
  runAuth.mockReset();
  getModule.mockReset();
  invalidateUserCache.mockReset();
  getModule.mockResolvedValue({ manifest: { poolable: false } });
  runAuth.mockResolvedValue({
    status: "completed",
    credentials: { accessToken: "fresh" },
    userConfigPatch: undefined,
  });
});

describe("OAuth completion — reconnect updates the existing connection", () => {
  it("pollDeviceAuth rebinds fresh credentials to the existing row instead of inserting", async () => {
    seedPending();
    seedBrokenConnection();

    const result = await pollDeviceAuth({ userId: "user-1", nonce: "nonce-1" });

    // Returns the SAME connection id — no duplicate row was created.
    expect(result).toEqual({ status: "completed", connectionId: "conn-1" });
    expect(state.inserts).toBe(0);
    expect(state.connections).toHaveLength(1);

    const row = state.connections[0]!;
    // Flipped back to a healthy, freshly-verified state.
    expect(row.status).toBe("connected");
    expect(row.errorMessage).toBeNull();
    expect(row.tokenExpiresAt).toBeNull();
    // Fresh credentials persisted.
    expect(decryptCreds(row)).toEqual({ accessToken: "fresh" });
    // Identity + user-owned fields preserved across the reconnect.
    expect(row.id).toBe("conn-1");
    expect(row.displayName).toBe("My Trakt");
    expect(row.isDefault).toBe(1);
    expect(JSON.parse(row.userConfig!)).toEqual({ slug: "keep-me" });
    expect(invalidateUserCache).toHaveBeenCalledWith("user-1");
  });

  it("completeRedirectAuth rebinds to the existing row for the redirect flow", async () => {
    seedPending();
    seedBrokenConnection();

    const result = await completeRedirectAuth({
      userId: "user-1",
      nonce: "nonce-1",
      queryParams: { code: "abc" },
    });

    expect(result).toEqual({ connectionId: "conn-1" });
    expect(state.inserts).toBe(0);
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0]!.status).toBe("connected");
    expect(decryptCreds(state.connections[0]!)).toEqual({ accessToken: "fresh" });
  });

  it("inserts a new connection when the user has none for the plugin (first connect)", async () => {
    seedPending();
    // No existing connection seeded.

    const result = await pollDeviceAuth({ userId: "user-1", nonce: "nonce-1" });

    expect(result.status).toBe("completed");
    expect(state.inserts).toBe(1);
    expect(state.connections).toHaveLength(1);
    const row = state.connections[0]!;
    expect(row.status).toBe("connected");
    expect(row.pluginId).toBe("trakt");
    // A fresh id, not the reconnect path's reuse.
    expect(row.id).not.toBe("conn-1");
  });
});
