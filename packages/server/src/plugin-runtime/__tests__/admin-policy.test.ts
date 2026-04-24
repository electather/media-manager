import { describe, it, expect, beforeEach, vi } from "vite-plus/test";

// Ensure env is populated before anything under test imports it.
vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    APP_EXTERNAL_URL: "https://media.example.com",
  },
}));

interface PluginRow {
  id: string;
  adminAllowlist: string | null;
  adminHeadersEncrypted: string | null;
  adminHeadersIv: string | null;
}

const rows = new Map<string, PluginRow>();

// Minimal drizzle-shaped fake: supports `select().from(..).where(..).get()`,
// `update(..).set(..).where(..).returning(..)` and `.where(..).` (no returning).
// The real drizzle chain is richer; this captures exactly what admin-policy
// touches and nothing more.
let lastFilterId: string | null = null;

// Drizzle's `.update(...).set(...).where(...)` is thenable in real code but
// our fake returns a thenable-shaped Promise. `admin-policy.ts` sometimes
// chains `.returning()` and sometimes awaits the `where()` result directly;
// we support both by returning a Promise that also exposes a `returning`
// method.
function makeUpdateResult(returning: () => Promise<Array<{ id: string }>>) {
  const base = Promise.resolve() as Promise<void> & {
    returning: () => Promise<Array<{ id: string }>>;
  };
  base.returning = returning;
  return base;
}

const dbMock = {
  select(_projection?: unknown) {
    return {
      from(_table: unknown) {
        return {
          where(predicate: unknown) {
            const pred = predicate as { id?: string } | null | undefined;
            lastFilterId = pred?.id ?? null;
            return {
              async get() {
                if (!lastFilterId) return rows.values().next().value;
                return rows.get(lastFilterId) ?? null;
              },
            };
          },
        };
      },
    };
  },
  update(_table: unknown) {
    return {
      set(patch: Partial<PluginRow>) {
        return {
          where(predicate: { id?: string }) {
            const id = predicate?.id ?? null;
            const existing = id ? rows.get(id) : null;
            if (!existing) {
              return makeUpdateResult(async () => []);
            }
            Object.assign(existing, patch);
            rows.set(existing.id, existing);
            return makeUpdateResult(async () => [{ id: existing.id }]);
          },
        };
      },
    };
  },
};

vi.mock("../../db/client", () => ({ getDb: () => dbMock }));

// Treat our fake `plugins` as the drizzle table; admin-policy builds
// `eq(plugins.id, ...)` which reduces to `{ id }` in our mock's predicate.
vi.mock("../../db/schema/plugins", () => ({
  plugins: {
    id: "id",
    adminAllowlist: "adminAllowlist",
    adminHeadersEncrypted: "adminHeadersEncrypted",
    adminHeadersIv: "adminHeadersIv",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (column: unknown, value: unknown) => ({ [String(column)]: value }),
}));

// Deterministic "encryption" — we care about round-trip, not crypto.
vi.mock("../../crypto/helpers", () => ({
  async encryptJson(value: unknown) {
    return { iv: "iv-fixture", data: JSON.stringify(value) };
  },
  async decryptJson(iv: string | null, data: string | null) {
    if (!iv || !data) return null;
    return JSON.parse(data);
  },
}));

// Load after mocks are registered.
const {
  _resetPluginPolicyCacheForTests,
  listAdminHeaderNames,
  loadPluginPolicy,
  setAdminAllowlist,
  updateAdminHeaders,
  invalidatePluginPolicy,
} = await import("../admin-policy");

const PLUGIN_ID = "trakt";

function seedRow(overrides: Partial<PluginRow> = {}) {
  rows.clear();
  rows.set(PLUGIN_ID, {
    id: PLUGIN_ID,
    adminAllowlist: null,
    adminHeadersEncrypted: null,
    adminHeadersIv: null,
    ...overrides,
  });
  _resetPluginPolicyCacheForTests();
}

describe("loadPluginPolicy", () => {
  beforeEach(() => seedRow());

  it("returns null allowlist and undefined headers for a fresh plugin row", async () => {
    const policy = await loadPluginPolicy(PLUGIN_ID);
    expect(policy).toEqual({ adminAllowlist: null, adminHeaders: undefined });
  });

  it("parses stored allowlist JSON into an array of strings", async () => {
    seedRow({ adminAllowlist: JSON.stringify(["api.trakt.tv", "*.tmdb.org"]) });
    const policy = await loadPluginPolicy(PLUGIN_ID);
    expect(policy.adminAllowlist).toEqual(["api.trakt.tv", "*.tmdb.org"]);
  });

  it("returns null allowlist for malformed JSON rather than throwing", async () => {
    seedRow({ adminAllowlist: "not-json" });
    const policy = await loadPluginPolicy(PLUGIN_ID);
    expect(policy.adminAllowlist).toBeNull();
  });

  it("decrypts stored admin headers and normalises names to lowercase", async () => {
    const stored = JSON.stringify({ "X-Corp-Key": "abc" });
    seedRow({ adminHeadersIv: "iv-fixture", adminHeadersEncrypted: stored });
    const policy = await loadPluginPolicy(PLUGIN_ID);
    expect(policy.adminHeaders).toEqual({ "x-corp-key": "abc" });
  });

  it("caches: second call does not re-read the row", async () => {
    seedRow({ adminAllowlist: JSON.stringify(["api.trakt.tv"]) });
    await loadPluginPolicy(PLUGIN_ID);
    // Mutate the underlying row behind the cache's back.
    rows.get(PLUGIN_ID)!.adminAllowlist = JSON.stringify(["api.tmdb.org"]);
    const again = await loadPluginPolicy(PLUGIN_ID);
    expect(again.adminAllowlist).toEqual(["api.trakt.tv"]);
  });

  it("invalidatePluginPolicy forces a reload", async () => {
    seedRow({ adminAllowlist: JSON.stringify(["api.trakt.tv"]) });
    await loadPluginPolicy(PLUGIN_ID);
    rows.get(PLUGIN_ID)!.adminAllowlist = JSON.stringify(["api.tmdb.org"]);
    invalidatePluginPolicy(PLUGIN_ID);
    const again = await loadPluginPolicy(PLUGIN_ID);
    expect(again.adminAllowlist).toEqual(["api.tmdb.org"]);
  });
});

describe("setAdminAllowlist", () => {
  beforeEach(() => seedRow());

  it("lowercases entries on write", async () => {
    await setAdminAllowlist(PLUGIN_ID, ["API.Trakt.TV"]);
    const stored = rows.get(PLUGIN_ID)!.adminAllowlist;
    expect(JSON.parse(stored!)).toEqual(["api.trakt.tv"]);
  });

  it("null clears the allowlist column", async () => {
    rows.get(PLUGIN_ID)!.adminAllowlist = JSON.stringify(["x"]);
    await setAdminAllowlist(PLUGIN_ID, null);
    expect(rows.get(PLUGIN_ID)!.adminAllowlist).toBeNull();
  });

  it("invalidates the cache so the next load reflects the write", async () => {
    await loadPluginPolicy(PLUGIN_ID);
    await setAdminAllowlist(PLUGIN_ID, ["api.trakt.tv"]);
    const policy = await loadPluginPolicy(PLUGIN_ID);
    expect(policy.adminAllowlist).toEqual(["api.trakt.tv"]);
  });
});

describe("updateAdminHeaders", () => {
  beforeEach(() => seedRow());

  it("adds new headers and persists encrypted blob with lowercased names", async () => {
    await updateAdminHeaders(PLUGIN_ID, { "X-Corp-Key": "abc", "X-Env": "prod" });
    const row = rows.get(PLUGIN_ID)!;
    expect(row.adminHeadersIv).toBe("iv-fixture");
    expect(JSON.parse(row.adminHeadersEncrypted!)).toEqual({
      "x-corp-key": "abc",
      "x-env": "prod",
    });
  });

  it("null value deletes a specific header; omitted keys preserve existing", async () => {
    await updateAdminHeaders(PLUGIN_ID, { "X-A": "1", "X-B": "2" });
    await updateAdminHeaders(PLUGIN_ID, { "X-A": null });
    const row = rows.get(PLUGIN_ID)!;
    expect(JSON.parse(row.adminHeadersEncrypted!)).toEqual({ "x-b": "2" });
  });

  it("delete is case-insensitive — patch casing may differ from the casing used to add", async () => {
    await updateAdminHeaders(PLUGIN_ID, { Authorization: "Bearer abc" });
    await updateAdminHeaders(PLUGIN_ID, { authorization: null });
    const row = rows.get(PLUGIN_ID)!;
    expect(row.adminHeadersEncrypted).toBeNull();
    expect(row.adminHeadersIv).toBeNull();
  });

  it("update is case-insensitive — a differently-cased patch replaces the existing value", async () => {
    await updateAdminHeaders(PLUGIN_ID, { Authorization: "old" });
    await updateAdminHeaders(PLUGIN_ID, { AUTHORIZATION: "new" });
    const row = rows.get(PLUGIN_ID)!;
    expect(JSON.parse(row.adminHeadersEncrypted!)).toEqual({ authorization: "new" });
  });

  it("deleting the last header clears the encrypted columns", async () => {
    await updateAdminHeaders(PLUGIN_ID, { "X-A": "1" });
    await updateAdminHeaders(PLUGIN_ID, { "X-A": null });
    const row = rows.get(PLUGIN_ID)!;
    expect(row.adminHeadersIv).toBeNull();
    expect(row.adminHeadersEncrypted).toBeNull();
  });

  it("rejects a merge that would push the stored total past the ceiling", async () => {
    const firstBatch: Record<string, string> = {};
    for (let i = 0; i < 30; i += 1) firstBatch[`x-a-${i}`] = "v";
    await updateAdminHeaders(PLUGIN_ID, firstBatch);

    const secondBatch: Record<string, string> = {};
    for (let i = 0; i < 5; i += 1) secondBatch[`x-b-${i}`] = "v";
    await expect(updateAdminHeaders(PLUGIN_ID, secondBatch)).rejects.toMatchObject({
      code: "plugin.input_invalid",
    });
  });

  it("throws plugin.not_found when the row has been deleted between load and write", async () => {
    // Prime the cache, then drop the row so the UPDATE matches nothing.
    await loadPluginPolicy(PLUGIN_ID);
    rows.delete(PLUGIN_ID);
    await expect(updateAdminHeaders(PLUGIN_ID, { "X-A": "1" })).rejects.toMatchObject({
      code: "plugin.not_found",
    });
  });

  it("rejects reserved header names (case-insensitive)", async () => {
    await expect(updateAdminHeaders(PLUGIN_ID, { Host: "evil" })).rejects.toMatchObject({
      code: "plugin.input_invalid",
    });
    await expect(updateAdminHeaders(PLUGIN_ID, { "content-length": "0" })).rejects.toMatchObject({
      code: "plugin.input_invalid",
    });
  });

  it("invalidates cache so the next load reflects the write", async () => {
    await loadPluginPolicy(PLUGIN_ID);
    await updateAdminHeaders(PLUGIN_ID, { "X-Added": "late" });
    const policy = await loadPluginPolicy(PLUGIN_ID);
    expect(policy.adminHeaders).toEqual({ "x-added": "late" });
  });
});

describe("listAdminHeaderNames", () => {
  beforeEach(() => seedRow());

  it("returns sorted, lowercased header names when headers are configured", async () => {
    await updateAdminHeaders(PLUGIN_ID, { "X-Z": "1", "X-A": "2", "X-M": "3" });
    const names = await listAdminHeaderNames(PLUGIN_ID);
    expect(names).toEqual(["x-a", "x-m", "x-z"]);
  });

  it("returns [] when no headers are set", async () => {
    const names = await listAdminHeaderNames(PLUGIN_ID);
    expect(names).toEqual([]);
  });
});

describe("shared schema: pluginAdminAllowlistSchema", () => {
  it("accepts null", async () => {
    const { pluginAdminAllowlistSchema } = await import("@ent-mcp/shared/plugins");
    expect(pluginAdminAllowlistSchema.safeParse({ allowlist: null }).success).toBe(true);
  });

  it("accepts wildcards, exact hostnames, and subdomain patterns", async () => {
    const { pluginAdminAllowlistSchema } = await import("@ent-mcp/shared/plugins");
    const result = pluginAdminAllowlistSchema.safeParse({
      allowlist: ["*", "api.trakt.tv", "*.tmdb.org"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects uppercase entries", async () => {
    const { pluginAdminAllowlistSchema } = await import("@ent-mcp/shared/plugins");
    const result = pluginAdminAllowlistSchema.safeParse({ allowlist: ["API.Trakt.TV"] });
    expect(result.success).toBe(false);
  });

  it("rejects duplicates", async () => {
    const { pluginAdminAllowlistSchema } = await import("@ent-mcp/shared/plugins");
    const result = pluginAdminAllowlistSchema.safeParse({
      allowlist: ["api.trakt.tv", "api.trakt.tv"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed hostnames", async () => {
    const { pluginAdminAllowlistSchema } = await import("@ent-mcp/shared/plugins");
    expect(pluginAdminAllowlistSchema.safeParse({ allowlist: ["has spaces"] }).success).toBe(false);
    expect(pluginAdminAllowlistSchema.safeParse({ allowlist: ["http://foo"] }).success).toBe(false);
  });
});

describe("shared schema: pluginAdminHeadersSchema", () => {
  it("accepts non-empty string values and nulls to delete", async () => {
    const { pluginAdminHeadersSchema } = await import("@ent-mcp/shared/plugins");
    const result = pluginAdminHeadersSchema.safeParse({
      headers: { "X-Corp-Key": "abc", "X-Delete-Me": null },
    });
    expect(result.success).toBe(true);
  });

  it("rejects values containing CR or LF (header-injection)", async () => {
    const { pluginAdminHeadersSchema } = await import("@ent-mcp/shared/plugins");
    expect(
      pluginAdminHeadersSchema.safeParse({ headers: { "X-Foo": "a\r\nX-Smuggle: evil" } }).success,
    ).toBe(false);
  });

  it("rejects reserved header names", async () => {
    const { pluginAdminHeadersSchema } = await import("@ent-mcp/shared/plugins");
    expect(pluginAdminHeadersSchema.safeParse({ headers: { Host: "x" } }).success).toBe(false);
    expect(
      pluginAdminHeadersSchema.safeParse({ headers: { connection: "keep-alive" } }).success,
    ).toBe(false);
  });

  it("rejects empty-string values — admin must pass null to delete", async () => {
    const { pluginAdminHeadersSchema } = await import("@ent-mcp/shared/plugins");
    expect(pluginAdminHeadersSchema.safeParse({ headers: { "X-Foo": "" } }).success).toBe(false);
  });

  it("rejects header names with disallowed characters", async () => {
    const { pluginAdminHeadersSchema } = await import("@ent-mcp/shared/plugins");
    expect(pluginAdminHeadersSchema.safeParse({ headers: { "X Foo": "bar" } }).success).toBe(false);
    expect(pluginAdminHeadersSchema.safeParse({ headers: { "X:Foo": "bar" } }).success).toBe(false);
  });
});
