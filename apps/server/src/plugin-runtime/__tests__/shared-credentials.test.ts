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

// NOTE: this mock ignores `where(...)` predicates and returns the entire seeded
// rowset on every query. Existing tests work because the duplicate-label /
// not-poolable logic runs in JS *after* `list()` returns. Tests that need to
// exercise the per-credentialId or per-pluginId predicates must seed multiple
// rows and either pick their own row in JS, or upgrade this mock to honour the
// drizzle filter identity. Without that, a regression in the `where` clause
// would silently pass.
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

function installPlugin(pluginId: string, poolable: boolean) {
  state.plugins = [{ id: pluginId, manifest: JSON.stringify({ poolable }) }];
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
});
