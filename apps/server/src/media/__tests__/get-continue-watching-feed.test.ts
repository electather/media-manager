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

const dispatchAggregateMock = vi.fn();
vi.mock("../service/dispatch", () => ({
  dispatchAggregate: (...args: unknown[]) => dispatchAggregateMock(...args),
  dispatchPrimary: vi.fn(),
  dispatchSingle: vi.fn(),
}));

const { MediaService } = await import("../service");
const { AllPluginsFailedError } = await import("../errors");

beforeEach(() => {
  dispatchAggregateMock.mockReset();
});

describe("MediaService.getContinueWatchingFeed", () => {
  it("returns empty + partial=false when no providers were attempted", async () => {
    dispatchAggregateMock.mockResolvedValue({ data: [], errors: [], attempted: 0 });
    const svc = new MediaService("u1");
    const res = await svc.getContinueWatchingFeed();
    expect(res.items).toEqual([]);
    expect(res.partial).toBe(false);
  });

  it("propagates partial=true when one provider errored alongside data", async () => {
    dispatchAggregateMock.mockResolvedValue({
      data: [{ item: { id: "ep:1", title: "Ep", type: "episode" }, progressMs: 100 }],
      errors: [
        {
          pluginId: "jellyfin",
          connectionId: null,
          code: "plugin.upstream_error",
          devMessage: "x",
        },
      ],
      attempted: 2,
    });
    const svc = new MediaService("u1");
    const res = await svc.getContinueWatchingFeed();
    expect(res.items).toHaveLength(1);
    expect(res.partial).toBe(true);
  });

  it("throws AllPluginsFailedError when every attempted provider errored terminally", async () => {
    dispatchAggregateMock.mockResolvedValue({
      data: [],
      errors: [
        { pluginId: "plex", connectionId: null, code: "plugin.token_expired", devMessage: "x" },
        {
          pluginId: "jellyfin",
          connectionId: null,
          code: "plugin.bad_credentials",
          devMessage: "y",
        },
      ],
      attempted: 2,
    });
    const svc = new MediaService("u1");
    await expect(svc.getContinueWatchingFeed()).rejects.toBeInstanceOf(AllPluginsFailedError);
  });

  it("soft-degrades to empty + partial when every provider errored transiently", async () => {
    dispatchAggregateMock.mockResolvedValue({
      data: [],
      errors: [
        { pluginId: "plex", connectionId: null, code: "plugin.rate_limited", devMessage: "x" },
        { pluginId: "jellyfin", connectionId: null, code: "plugin.timeout", devMessage: "y" },
      ],
      attempted: 2,
    });
    const svc = new MediaService("u1");
    const res = await svc.getContinueWatchingFeed();
    expect(res.items).toEqual([]);
    expect(res.partial).toBe(true);
  });

  it("forwards the deadline option to the dispatcher", async () => {
    dispatchAggregateMock.mockResolvedValue({ data: [], errors: [], attempted: 0 });
    const svc = new MediaService("u1");
    await svc.getContinueWatchingFeed({ deadlineMs: 12345 });
    expect(dispatchAggregateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "continueWatching",
        version: "v1",
        method: "getContinueWatching",
        deadlineMs: 12345,
      }),
    );
  });
});
