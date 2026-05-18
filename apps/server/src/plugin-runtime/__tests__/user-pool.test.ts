import { describe, it, expect, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
  },
}));

// Minimal connection row shape used by the queries below.
type FakeRow = {
  id: string;
  isDefault: number;
  credentialsIv: string | null;
  encryptedCredentials: string | null;
  retryAfter: number | null;
  userConfig: string | null;
};

let fakeRows: FakeRow[] = [];

vi.mock("../../db/client", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            all: async () => fakeRows,
          }),
        }),
      }),
    }),
  }),
}));

vi.mock("../../db/schema/credentials", () => ({
  serviceConnections: {},
}));

// We spy on decryptJson to control its return value per row.
const decryptJsonMock = vi.fn();
vi.mock("../../crypto/helpers", () => ({
  decryptJson: (...args: unknown[]) => decryptJsonMock(...args),
}));

import { listReadyUserConnections } from "../user-pool";

describe("listReadyUserConnections", () => {
  it("skips rows where decryptJson returns null", async () => {
    fakeRows = [
      {
        id: "conn-1",
        isDefault: 0,
        credentialsIv: null,
        encryptedCredentials: null,
        retryAfter: null,
        userConfig: null,
      },
      {
        id: "conn-2",
        isDefault: 1,
        credentialsIv: "iv",
        encryptedCredentials: "data",
        retryAfter: null,
        userConfig: null,
      },
    ];
    decryptJsonMock
      .mockResolvedValueOnce(null) // conn-1: corrupt/missing ciphertext
      .mockResolvedValueOnce({ authToken: "tok" }); // conn-2: valid

    const result = await listReadyUserConnections("user-1", "plex");

    expect(result).toHaveLength(1);
    expect(result[0]!.connectionId).toBe("conn-2");
    expect(result[0]!.credentials).toEqual({ authToken: "tok" });
  });

  it("returns all rows when all ciphertexts decrypt successfully", async () => {
    fakeRows = [
      {
        id: "c1",
        isDefault: 1,
        credentialsIv: "iv",
        encryptedCredentials: "data",
        retryAfter: null,
        userConfig: null,
      },
    ];
    decryptJsonMock.mockResolvedValueOnce({ token: "x" });

    const result = await listReadyUserConnections("user-1", "plex");
    expect(result).toHaveLength(1);
  });

  it("skips rows where decryptJson throws (corrupt ciphertext)", async () => {
    fakeRows = [
      {
        id: "bad",
        isDefault: 0,
        credentialsIv: "iv",
        encryptedCredentials: "data",
        retryAfter: null,
        userConfig: null,
      },
      {
        id: "good",
        isDefault: 1,
        credentialsIv: "iv2",
        encryptedCredentials: "data2",
        retryAfter: null,
        userConfig: null,
      },
    ];
    decryptJsonMock
      .mockRejectedValueOnce(new Error("decryption failed"))
      .mockResolvedValueOnce({ token: "ok" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await listReadyUserConnections("user-1", "plex");

    expect(result).toHaveLength(1);
    expect(result[0]!.connectionId).toBe("good");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
