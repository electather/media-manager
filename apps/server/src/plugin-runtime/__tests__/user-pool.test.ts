import { consola } from "consola";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  },
}));

interface Row {
  id: string;
  userId: string;
  pluginId: string;
  enabled: number;
  isDefault: number;
  userConfig: string | null;
  encryptedCredentials: string | null;
  credentialsIv: string | null;
  retryAfter: number | null;
  createdAt: number;
}

const state: { rows: Row[] } = { rows: [] };

const dbMock = {
  select() {
    return {
      from() {
        return {
          where() {
            return {
              orderBy() {
                return {
                  async all() {
                    return state.rows;
                  },
                };
              },
            };
          },
        };
      },
    };
  },
};

vi.mock("../../db/client", () => ({ getDb: () => dbMock }));

vi.mock("../../db/schema/plugin-runtime/credentials", () => ({
  serviceConnections: {},
}));

const decryptJsonMock = vi.fn(async (_iv: string | null, data: string | null) => {
  if (!data) return null;
  return { secret: data };
});

vi.mock("../../crypto/helpers", () => ({
  decryptJson: (iv: string | null, data: string | null) => decryptJsonMock(iv, data),
}));

const { listReadyUserConnections } = await import("../internal/user-pool");

function seed(partial: Partial<Row>): Row {
  return {
    id: "conn-1",
    userId: "u1",
    pluginId: "p1",
    enabled: 1,
    isDefault: 0,
    userConfig: null,
    encryptedCredentials: "enc",
    credentialsIv: "iv",
    retryAfter: null,
    createdAt: 0,
    ...partial,
  };
}

beforeEach(() => {
  state.rows = [];
  decryptJsonMock.mockReset();
  decryptJsonMock.mockImplementation(async (_iv, data) => {
    if (!data) return null;
    return { secret: data };
  });
  vi.restoreAllMocks();
});

describe("listReadyUserConnections", () => {
  it("returns parsed userConfig for valid JSON rows", async () => {
    state.rows = [seed({ id: "ok", userConfig: JSON.stringify({ region: "eu" }) })];
    const picks = await listReadyUserConnections("u1", "p1");
    expect(picks).toHaveLength(1);
    expect(picks[0]?.userConfig).toEqual({ region: "eu" });
  });

  it("returns null userConfig when the column is null", async () => {
    state.rows = [seed({ id: "no-config", userConfig: null })];
    const picks = await listReadyUserConnections("u1", "p1");
    expect(picks).toHaveLength(1);
    expect(picks[0]?.userConfig).toBeNull();
  });

  it("skips rows with malformed userConfig and warns instead of throwing", async () => {
    // Regression for #299: a single corrupt row used to throw and drop the
    // entire batch, leaving the user with zero usable connections.
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    state.rows = [
      seed({ id: "bad", userConfig: "{not json" }),
      seed({ id: "good", userConfig: JSON.stringify({ ok: true }) }),
    ];
    const picks = await listReadyUserConnections("u1", "p1");
    expect(picks.map((p) => p.connectionId)).toEqual(["good"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("bad");
  });

  it("skips rows where decryptJson returns null", async () => {
    // Regression for #336: a row with null ciphertext used to pass null
    // credentials straight to the plugin, causing silent unauthenticated calls.
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    state.rows = [
      seed({ id: "null-row", credentialsIv: null, encryptedCredentials: null }),
      seed({ id: "good", credentialsIv: "iv", encryptedCredentials: "data" }),
    ];
    const picks = await listReadyUserConnections("u1", "p1");
    expect(picks.map((p) => p.connectionId)).toEqual(["good"]);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0]?.[0]).toContain("null-row");
  });

  it("skips rows where decryptJson throws (corrupt ciphertext)", async () => {
    // Regression for #336 follow-up: corrupt ciphertext makes decryptJson throw.
    // The throw used to abort the whole pool lookup, dropping every later valid
    // connection. Guard catches and skips just the bad row.
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => undefined);
    decryptJsonMock.mockImplementationOnce(async () => {
      throw new Error("decryption failed");
    });
    state.rows = [
      seed({ id: "bad", credentialsIv: "iv", encryptedCredentials: "data" }),
      seed({ id: "good", credentialsIv: "iv2", encryptedCredentials: "data2" }),
    ];
    const picks = await listReadyUserConnections("u1", "p1");
    expect(picks.map((p) => p.connectionId)).toEqual(["good"]);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0]?.[0]).toContain("bad");
  });
});
