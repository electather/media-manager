import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { PluginError } from "@nama/plugin-sdk";

vi.mock("../../env", () => ({
  env: { ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" },
}));

interface Row {
  id: string;
  pluginId: string;
  label: string;
  encryptedValue: string;
  iv: string;
  enabled: number;
  lastExhaustedAt: number | null;
  retryAfter: number | null;
  createdAt: number;
  updatedAt: number;
}

interface PluginRow {
  id: string;
  manifest: string;
  installedAt: number;
  updatedAt: number;
}

const state: {
  entries: Row[];
  plugins: PluginRow[];
} = { entries: [], plugins: [] };

function chainable<T>(value: T) {
  const p = Promise.resolve(value);
  return Object.assign(p, {
    returning: async () => value,
  });
}

// NOTE: this mock ignores `where(...)` predicates and returns the full seeded rowset. Existing
// tests work because duplicate-label/not-poolable logic runs in JS after list() returns. Tests
// that need per-credentialId or per-pluginId filtering must seed multiple rows and filter in JS,
// or upgrade this mock to honour drizzle filter identity — otherwise where() regressions pass silently.
const dbMock = {
  select() {
    return {
      from(table: unknown) {
        const isPlugins = Object.prototype.hasOwnProperty.call(table, "manifest");
        return {
          where(_: unknown) {
            return {
              async get() {
                return isPlugins ? state.plugins[0] : state.entries[0];
              },
              async all() {
                return isPlugins ? state.plugins : state.entries;
              },
            };
          },
        };
      },
    };
  },
  insert(_table: unknown) {
    return {
      async values(row: Row) {
        state.entries.push(row);
      },
    };
  },
  update(_table: unknown) {
    return {
      set(patch: Partial<Row>) {
        return {
          where(_: unknown) {
            if (state.entries.length === 0) return chainable<Array<{ id: string }>>([]);
            Object.assign(state.entries[0]!, patch);
            return chainable([{ id: state.entries[0]!.id }]);
          },
        };
      },
    };
  },
  delete(_table: unknown) {
    return {
      where(_: unknown) {
        state.entries = [];
        return chainable<void>(undefined);
      },
    };
  },
};

vi.mock("../../db/client", () => ({ getDb: () => dbMock }));

vi.mock("../../crypto/helpers", () => ({
  async encryptJson(value: unknown) {
    return { iv: "iv", data: Buffer.from(JSON.stringify(value)).toString("base64") };
  },
  async decryptJson(_iv: string | null, data: string | null) {
    if (!data) return null;
    return JSON.parse(Buffer.from(data, "base64").toString());
  },
}));

const { sharedCredentialsService } = await import("../internal/shared-credentials");

function installPlugin(pluginId: string, poolable: boolean, extras?: Record<string, unknown>) {
  state.plugins = [
    {
      id: pluginId,
      manifest: JSON.stringify({ poolable, ...extras }),
      installedAt: 1000,
      updatedAt: 2000,
    },
  ];
}

const SHARED_SCHEMA = {
  type: "object",
  properties: { apiKey: { type: "string" } },
  required: ["apiKey"],
};

/** Installs a plugin that ships a bundled default credential. */
function installWithBundled(pluginId: string, poolable: boolean, key = "BUNDLED_KEY") {
  installPlugin(pluginId, poolable, {
    sharedCredentialsSchema: SHARED_SCHEMA,
    defaultSharedCredentials: { apiKey: key },
  });
}

beforeEach(() => {
  state.entries = [];
  state.plugins = [];
});

describe("sharedCredentialsService", () => {
  it("adds and lists entries without exposing raw values", async () => {
    installPlugin("tmdb", true);
    const id = await sharedCredentialsService.add({
      pluginId: "tmdb",
      label: "Primary",
      value: { apiKey: "abc" },
    });
    const list = await sharedCredentialsService.list("tmdb");
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(id);
    expect(list[0]?.label).toBe("Primary");
    expect(list[0]?.enabled).toBe(true);
  });

  it("returns decrypted value only via getDecrypted", async () => {
    installPlugin("tmdb", true);
    const id = await sharedCredentialsService.add({
      pluginId: "tmdb",
      label: "Primary",
      value: { apiKey: "secret" },
    });
    const pick = await sharedCredentialsService.getDecrypted({
      pluginId: "tmdb",
      credentialId: id,
    });
    expect(pick.value).toEqual({ apiKey: "secret" });
  });

  it("rejects a second entry for a non-poolable plugin", async () => {
    installPlugin("trakt", false);
    await sharedCredentialsService.add({
      pluginId: "trakt",
      label: "Primary",
      value: { clientId: "x", clientSecret: "y" },
    });
    await expect(
      sharedCredentialsService.add({
        pluginId: "trakt",
        label: "Secondary",
        value: { clientId: "x2", clientSecret: "y2" },
      }),
    ).rejects.toThrow(PluginError);
  });

  it("rejects a duplicate label (case-insensitive) on add", async () => {
    installPlugin("tmdb", true);
    await sharedCredentialsService.add({
      pluginId: "tmdb",
      label: "Primary",
      value: { apiKey: "x" },
    });
    await expect(
      sharedCredentialsService.add({
        pluginId: "tmdb",
        label: "primary",
        value: { apiKey: "y" },
      }),
    ).rejects.toMatchObject({ code: "plugin.duplicate_label" });
  });

  it("rejects a duplicate label on rename", async () => {
    installPlugin("tmdb", true);
    const a = await sharedCredentialsService.add({
      pluginId: "tmdb",
      label: "Primary",
      value: { apiKey: "x" },
    });
    await sharedCredentialsService.add({
      pluginId: "tmdb",
      label: "Backup",
      value: { apiKey: "y" },
    });
    await expect(
      sharedCredentialsService.update({
        pluginId: "tmdb",
        credentialId: a,
        label: "backup",
      }),
    ).rejects.toMatchObject({ code: "plugin.duplicate_label" });
  });

  it("marks an entry exhausted with a retry window", async () => {
    installPlugin("tmdb", true);
    const id = await sharedCredentialsService.add({
      pluginId: "tmdb",
      label: "Primary",
      value: { apiKey: "x" },
    });
    await sharedCredentialsService.markExhausted({
      pluginId: "tmdb",
      credentialId: id,
      retryAfterSec: 30,
    });
    const list = await sharedCredentialsService.list("tmdb");
    expect(list[0]?.retryAfter).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  // ─── Bundled default shared credential (design 2026-06-29) ───

  it("appends the bundled default last in listDecryptedActive on an empty pool", async () => {
    // WHY: an empty pool must still yield a pick so buildCredentialPlan does not
    // throw capability_unavailable before the handler runs.
    installWithBundled("tmdb", true);
    const picks = await sharedCredentialsService.listDecryptedActive("tmdb");
    expect(picks).toHaveLength(1);
    expect(picks[0]?.id).toBe("__bundled__");
    expect(picks[0]?.value).toEqual({ apiKey: "BUNDLED_KEY" });
  });

  it("orders real entries before the bundled default", async () => {
    // WHY: an admin key must override the bundled fallback.
    installWithBundled("tmdb", true);
    await sharedCredentialsService.add({ pluginId: "tmdb", label: "Mine", value: { apiKey: "x" } });
    const picks = await sharedCredentialsService.listDecryptedActive("tmdb");
    expect(picks).toHaveLength(2);
    expect(picks[0]?.id).not.toBe("__bundled__");
    expect(picks.at(-1)?.id).toBe("__bundled__");
  });

  it("counts the bundled default as enabled on an empty pool", async () => {
    // WHY: countEnabled drives tmdbConfigured — bundled key makes onboarding optional.
    installWithBundled("tmdb", true);
    expect(await sharedCredentialsService.countEnabled("tmdb")).toBeGreaterThanOrEqual(1);
  });

  it("surfaces the bundled default as a read-only summary", async () => {
    installWithBundled("tmdb", true);
    const list = await sharedCredentialsService.list("tmdb");
    const bundled = list.find((e) => e.id === "__bundled__");
    expect(bundled).toMatchObject({
      label: "Bundled (default)",
      enabled: true,
      bundled: true,
      createdAt: 1000,
      updatedAt: 2000,
    });
  });

  it("rejects mutating the bundled default through by-id methods", async () => {
    // WHY: the bundled entry is immutable; its decrypted value is never fetched
    // via the by-id path, so surface bundled_readonly, not shared_credential_not_found.
    installWithBundled("tmdb", true);
    await expect(
      sharedCredentialsService.update({
        pluginId: "tmdb",
        credentialId: "__bundled__",
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "plugin.bundled_readonly" });
    await expect(
      sharedCredentialsService.delete({ pluginId: "tmdb", credentialId: "__bundled__" }),
    ).rejects.toMatchObject({ code: "plugin.bundled_readonly" });
    await expect(
      sharedCredentialsService.getDecrypted({ pluginId: "tmdb", credentialId: "__bundled__" }),
    ).rejects.toMatchObject({ code: "plugin.bundled_readonly" });
  });

  it("reserves the bundled label case-insensitively against add", async () => {
    // WHY: an admin must not shadow the bundled entry with a same-label key.
    installWithBundled("tmdb", true);
    await expect(
      sharedCredentialsService.add({
        pluginId: "tmdb",
        label: "Bundled (default)",
        value: { apiKey: "x" },
      }),
    ).rejects.toMatchObject({ code: "plugin.duplicate_label" });
    await expect(
      sharedCredentialsService.add({
        pluginId: "tmdb",
        label: "Bundled (Default)",
        value: { apiKey: "x" },
      }),
    ).rejects.toMatchObject({ code: "plugin.duplicate_label" });
  });

  it("allows a real key on a non-poolable plugin that ships a bundled default", async () => {
    // WHY: the synthetic entry must not consume the single non-poolable slot, or
    // the admin could never override the bundled key.
    installWithBundled("jellyfin", false);
    await expect(
      sharedCredentialsService.add({ pluginId: "jellyfin", label: "Mine", value: { apiKey: "x" } }),
    ).resolves.toBeDefined();
  });

  it("treats markExhausted on the bundled default as a no-op", async () => {
    // WHY: there is no DB row to persist; the public key is simply retried.
    installWithBundled("tmdb", true);
    await expect(
      sharedCredentialsService.markExhausted({ pluginId: "tmdb", credentialId: "__bundled__" }),
    ).resolves.toBeUndefined();
    expect(state.entries).toHaveLength(0);
  });

  it("synthesizes nothing for a plugin without a bundled default", async () => {
    // WHY: opt-in mechanism must not regress plugins that don't declare the field.
    installPlugin("tmdb", true);
    expect(await sharedCredentialsService.list("tmdb")).toHaveLength(0);
    expect(await sharedCredentialsService.listDecryptedActive("tmdb")).toHaveLength(0);
  });
});
