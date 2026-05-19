import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

const dispatchPrimaryMock = vi.fn();

vi.mock("../service/dispatch", () => ({
  dispatchPrimary: (...args: unknown[]) => dispatchPrimaryMock(...args),
  dispatchAggregate: vi.fn(),
  dispatchSingle: vi.fn(),
}));

vi.mock("../internal/resolve-connection", () => ({
  resolveConnections: vi.fn().mockResolvedValue([]),
}));

vi.mock("../service/invoke", () => ({
  invokeOne: vi.fn(),
}));

vi.mock("../internal/capability-lookup", () => ({
  requireCapability: () => ({ defaultTimeoutMs: 15_000 }),
}));

vi.mock("../../plugin-runtime/internal/registry", () => ({
  capabilityRegistry: {
    listProviders: vi.fn().mockReturnValue([]),
    get: vi.fn(),
  },
}));

const { MediaService } = await import("../service");

beforeEach(() => {
  dispatchPrimaryMock.mockReset();
});

describe("MediaService.getShowSeasons", () => {
  it("returns the seasons array on primary plugin success", async () => {
    const seasons = [
      {
        seasonNumber: 1,
        name: "Season 1",
        totalEpisodes: 7,
        episodes: [{ episodeNumber: 1, title: "Pilot" }],
      },
    ];
    dispatchPrimaryMock.mockResolvedValue({ data: { seasons } });
    const out = await new MediaService("u1").getShowSeasons("1396");
    expect(out).toEqual(seasons);
    expect(dispatchPrimaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "metadata",
        method: "getShowSeasons",
        input: { id: "1396" },
        mediaType: "tv",
      }),
    );
  });

  it("returns null when the primary plugin rejects", async () => {
    dispatchPrimaryMock.mockRejectedValue(new Error("plugin down"));
    const out = await new MediaService("u1").getShowSeasons("1396");
    expect(out).toBeNull();
  });

  it("returns null when payload is missing the seasons array", async () => {
    dispatchPrimaryMock.mockResolvedValue({ data: { other: "stuff" } });
    const out = await new MediaService("u1").getShowSeasons("1396");
    expect(out).toBeNull();
  });

  it("returns null when dispatch yields no data", async () => {
    dispatchPrimaryMock.mockResolvedValue({ data: null });
    const out = await new MediaService("u1").getShowSeasons("1396");
    expect(out).toBeNull();
  });
});
