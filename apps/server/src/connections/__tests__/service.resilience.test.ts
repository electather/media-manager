import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

// Correctness findings: (1) corrupt userConfig must degrade to null, not throw 500;
// (2) updateConnectionWhere (updateDisplayName, setEnabled) must reject missing/foreign ids via
// RETURNING zero-row guard — not a requireConnection pre-check — and invalidate cache;
// (3) connectionsService.test must short-circuit on zero-row UPDATE (TOCTOU guard, issue #761).

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

  // WHERE predicates are ignored — full rowsets are returned. Consequence: `connection.not_found`
  // assertions pass only because `state.connections` is empty, NOT because the WHERE was evaluated.
  // Seeding a row with a wrong id would make the mock return it and produce a false pass.
  // The foreign-connection (userId mismatch) case cannot be exercised here; requireConnection
  // ownership is covered by its own tests against the real DB.
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
              // UPDATE…RETURNING returns affected rows; empty rowset triggers connection.not_found.
              // WHERE is ignored — zero-row guard fires because state.connections is empty, NOT
              // because userId/connectionId were evaluated. Tests for mismatched-id rejection must seed no row.
              return {
                returning(_fields: unknown) {
                  return Promise.resolve(rows.map((r) => ({ id: r.id })));
                },
              };
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(_: unknown) {
          // The delete handler chains .returning() to detect a zero-row delete
          // (row removed before the transaction) and throw connection.not_found.
          // WHERE is ignored — an empty rowset is how that guard is exercised.
          const rows = rowsFor(table) as ConnectionRow[];
          const result = Promise.resolve(undefined) as Promise<undefined> & {
            returning(_fields: unknown): Promise<Array<{ id: string; isDefault: number }>>;
          };
          result.returning = () =>
            Promise.resolve(rows.map((r) => ({ id: r.id, isDefault: r.isDefault })));
          return result;
        },
      };
    },
    // The transactional delete handler runs its delete + fallback-default
    // promotion inside db.transaction(); the mock just invokes the callback
    // with itself as the tx handle so the same select/update/delete shims apply.
    transaction(fn: (tx: unknown) => unknown) {
      return Promise.resolve(fn(dbMock));
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
const testConnectionMock = vi.fn();

vi.mock("../../plugin-runtime", () => ({
  pluginRuntime: {
    runAuth: vi.fn(),
    // Indirection so tests can swap the implementation per test; vi.mock
    // factories are hoisted, so a vi.fn() returned directly from the factory
    // cannot be replaced via mockImplementation after the import.
    testConnection: (...args: unknown[]) => testConnectionMock(...args),
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
  testConnectionMock.mockReset();
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

describe("delete guard (issue #758)", () => {
  it("throws connection.not_found when the rowset is empty (mock ignores WHERE)", async () => {
    // DO NOT seed state.connections before this assertion: the db mock ignores
    // the WHERE predicate, so the guard fires here only because the rowset is
    // empty. Seeding any row would make the mock return it and bypass the guard,
    // silently turning this into a false pass.
    expect(state.connections).toHaveLength(0);
    installPlugin();
    // Sentinel: if installPlugin() seeds a connection (it shouldn't), the
    // WHERE-ignoring mock would return it and bypass the guard silently.
    expect(state.connections).toHaveLength(0);

    await expect(
      connectionsService.delete({ userId: "user-1", connectionId: "missing" }),
    ).rejects.toMatchObject({ status: 404, code: "connection.not_found" });
  });

  it("invalidates the user cache after a successful delete", async () => {
    // Deleted connections are reflected in the connections list; the cache must
    // be invalidated so callers get an up-to-date view.
    installPlugin();
    seedConnection();

    await connectionsService.delete({ userId: "user-1", connectionId: "conn-1" });

    expect(invalidateUserCacheMock).toHaveBeenCalledWith("user-1");
  });
});

describe("updateDisplayName guard (finding 2)", () => {
  it("throws connection.not_found when the rowset is empty (mock ignores WHERE)", async () => {
    // DO NOT seed state.connections before this assertion: the db mock ignores
    // the WHERE predicate, so the guard fires here only because the rowset is
    // empty. Seeding any row would make the mock return it and bypass the guard,
    // silently turning this into a false pass.
    expect(state.connections).toHaveLength(0);
    installPlugin();
    // Sentinel: if installPlugin() seeds a connection (it shouldn't), the
    // WHERE-ignoring mock would return it and bypass the guard silently.
    expect(state.connections).toHaveLength(0);

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

describe("updateConnectionWhere RETURNING guard", () => {
  it("setEnabled throws connection.not_found when the rowset is empty (mock ignores WHERE)", async () => {
    // setEnabled routes through the same updateConnectionWhere guard as
    // updateDisplayName, so a missing/foreign id must surface as 404 here too.
    // As above: DO NOT seed a row — the guard fires only on an empty rowset.
    installPlugin();

    await expect(
      connectionsService.setEnabled({
        userId: "user-1",
        connectionId: "missing",
        enabled: false,
      }),
    ).rejects.toMatchObject({ status: 404, code: "connection.not_found" });
  });
});

describe("setEnabled cache (issue #698)", () => {
  it("invalidates the user cache after a successful toggle", async () => {
    // The enabled flag affects which connections the list surfaces; callers need
    // an up-to-date view after the toggle so the cache must be invalidated,
    // matching updateDisplayName/delete/setDefault.
    installPlugin();
    seedConnection();

    await connectionsService.setEnabled({
      userId: "user-1",
      connectionId: "conn-1",
      enabled: false,
    });

    expect(invalidateUserCacheMock).toHaveBeenCalledWith("user-1");
  });
});

describe("setDefault guard (issue #698)", () => {
  it("throws connection.not_found when the connection is missing", async () => {
    // setDefault calls requireConnection before promoteToDefault; requireConnection throws
    // connection.not_found on a missing/foreign id, so the 404 fires before the inner transaction.
    // DO NOT seed a row — the guard fires only because the pre-check SELECT returns undefined.
    installPlugin();

    await expect(
      connectionsService.setDefault({ userId: "user-1", connectionId: "missing" }),
    ).rejects.toMatchObject({ status: 404, code: "connection.not_found" });
  });

  it("invalidates the user cache after a successful promotion", async () => {
    // The default flag drives which connection the list surfaces first; callers
    // need an up-to-date view after the promotion so the cache must be
    // invalidated, mirroring updateDisplayName/delete.
    installPlugin();
    seedConnection();

    await connectionsService.setDefault({ userId: "user-1", connectionId: "conn-1" });

    expect(invalidateUserCacheMock).toHaveBeenCalledWith("user-1");
  });
});

describe("connectionsService.test TOCTOU guard (issue #761)", () => {
  it("returns { ok: false } when the row is deleted between the pre-check and the status UPDATE", async () => {
    // TOCTOU: `test` SELECTs the row, runs testConnection, then UPDATEs status/errorMessage/lastVerifiedAt.
    // If the row is deleted between SELECT and UPDATE, .returning() yields zero rows; the guard must
    // return { ok: false } rather than silently writing to a ghost row.
    // Mid-flight delete is injected inside testConnectionMock so the pre-check passes but the UPDATE finds an empty rowset.
    installPlugin();
    seedConnection();
    testConnectionMock.mockImplementation(() => {
      state.connections = [];
      return Promise.resolve({ ok: true });
    });

    const result = await connectionsService.test({ userId: "user-1", connectionId: "conn-1" });
    expect(result).toEqual({ ok: false, message: "connection not found" });
  });
});
