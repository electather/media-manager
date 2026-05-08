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

const dispatchToConnectionMock = vi.fn();
const listEligibleConnectionsMock = vi.fn();

vi.mock("../connection-targeted", () => ({
  dispatchToConnection: (...args: unknown[]) => dispatchToConnectionMock(...args),
  listEligibleConnections: (...args: unknown[]) => listEligibleConnectionsMock(...args),
}));

vi.mock("../dispatcher", () => ({
  dispatchAggregate: vi.fn(),
  dispatchPrimary: vi.fn(),
  dispatchSingle: vi.fn(),
}));

vi.mock("../../plugin-runtime/registry", () => ({
  capabilityRegistry: { listProviders: vi.fn(() => []), get: vi.fn() },
}));

vi.mock("../resolve-connection", () => ({ resolveConnections: vi.fn(() => []) }));
vi.mock("../invoke", () => ({ invokeOne: vi.fn() }));
vi.mock("../capability-lookup", () => ({
  requireCapability: () => ({ defaultTimeoutMs: 15_000 }),
  scopeForRequest: () => "user",
}));

const { MediaService } = await import("../service");
const { PluginCallError } = await import("../errors");
const { HttpError } = await import("../../errors/http-errors");

beforeEach(() => {
  dispatchToConnectionMock.mockReset();
  listEligibleConnectionsMock.mockReset();
});

describe("MediaService.listRequestTargets", () => {
  it("aggregates targets across eligible connections", async () => {
    listEligibleConnectionsMock.mockResolvedValueOnce([
      { connectionId: "conn-1", pluginId: "seerr", isDefault: true },
      { connectionId: "conn-2", pluginId: "seerr", isDefault: false },
    ]);
    dispatchToConnectionMock.mockImplementation(({ connectionId }: { connectionId: string }) =>
      Promise.resolve({
        targets: [
          {
            targetId: connectionId === "conn-1" ? "1" : "9",
            label: connectionId === "conn-1" ? "Radarr A" : "Radarr B",
            exposesProfiles: true,
            defaultProfileId: null,
            profiles: [],
          },
        ],
      }),
    );
    const svc = new MediaService("u1");
    const out = await svc.listRequestTargets("movie");
    expect(out).toHaveLength(2);
    expect(out[0]?.serviceId).toBe("conn-1:1");
    expect(out[1]?.serviceId).toBe("conn-2:9");
  });

  it("skips a connection whose listTargets call rejects", async () => {
    listEligibleConnectionsMock.mockResolvedValueOnce([
      { connectionId: "conn-1", pluginId: "seerr", isDefault: true },
      { connectionId: "conn-2", pluginId: "seerr", isDefault: false },
    ]);
    dispatchToConnectionMock.mockRejectedValueOnce(new Error("boom"));
    dispatchToConnectionMock.mockResolvedValueOnce({
      targets: [
        {
          targetId: "9",
          label: "Live",
          exposesProfiles: false,
          defaultProfileId: null,
          profiles: [],
        },
      ],
    });
    const svc = new MediaService("u1");
    const out = await svc.listRequestTargets("movie");
    expect(out).toHaveLength(1);
    expect(out[0]?.serviceId).toBe("conn-2:9");
  });

  it("drops targets with illegal targetId", async () => {
    listEligibleConnectionsMock.mockResolvedValueOnce([
      { connectionId: "conn-1", pluginId: "seerr", isDefault: true },
    ]);
    dispatchToConnectionMock.mockResolvedValueOnce({
      targets: [
        {
          targetId: "ok-1",
          label: "Good",
          exposesProfiles: false,
          defaultProfileId: null,
          profiles: [],
        },
        {
          targetId: "bad:id",
          label: "Bad",
          exposesProfiles: false,
          defaultProfileId: null,
          profiles: [],
        },
      ],
    });
    const svc = new MediaService("u1");
    const out = await svc.listRequestTargets("movie");
    expect(out).toHaveLength(1);
    expect(out[0]?.serviceId).toBe("conn-1:ok-1");
  });

  it("returns an empty array when no connections are eligible", async () => {
    listEligibleConnectionsMock.mockResolvedValueOnce([]);
    const svc = new MediaService("u1");
    const out = await svc.listRequestTargets("tv");
    expect(out).toEqual([]);
  });
});

describe("MediaService.requestDownload", () => {
  it("decodes serviceId and forwards seasons only for tv", async () => {
    dispatchToConnectionMock.mockResolvedValueOnce({ success: true, requestId: "42" });
    const svc = new MediaService("u1");
    const result = await svc.requestDownload({
      tmdbId: "1399",
      mediaType: "tv",
      serviceId: "conn-1:5",
      profileId: "7",
      seasons: [1, 2],
    });
    expect(result).toEqual({ requestId: "42" });
    expect(dispatchToConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "conn-1",
        capability: "mediaRequest",
        method: "createRequest",
        input: expect.objectContaining({
          tmdbId: "1399",
          type: "tv",
          seasons: "1,2",
          targetId: "5",
          profileId: "7",
        }),
      }),
    );
  });

  it("ignores seasons when mediaType is movie", async () => {
    dispatchToConnectionMock.mockResolvedValueOnce({ success: true, requestId: "1" });
    const svc = new MediaService("u1");
    await svc.requestDownload({
      tmdbId: "550",
      mediaType: "movie",
      serviceId: "conn-1:2",
      seasons: [1],
    });
    expect(dispatchToConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ seasons: undefined }),
      }),
    );
  });

  it("throws 400 on malformed serviceId", async () => {
    const svc = new MediaService("u1");
    await expect(
      svc.requestDownload({ tmdbId: "550", mediaType: "movie", serviceId: "no-colon" }),
    ).rejects.toMatchObject({ status: 400, code: "request.invalid_input" });
    expect(dispatchToConnectionMock).not.toHaveBeenCalled();
  });

  it("maps mcp.target_not_found to 404", async () => {
    dispatchToConnectionMock.mockRejectedValueOnce(
      new PluginCallError("mcp.target_not_found", "missing", "seerr", "conn-1"),
    );
    const svc = new MediaService("u1");
    await expect(
      svc.requestDownload({ tmdbId: "550", mediaType: "movie", serviceId: "conn-1:1" }),
    ).rejects.toMatchObject({ status: 404, code: "request.unknown_service" });
  });

  it.each([
    ["plugin.input_invalid" as const],
    ["plugin.upstream_error" as const],
    ["plugin.timeout" as const],
  ])("maps PluginCallError(%s) to 502", async (code) => {
    dispatchToConnectionMock.mockRejectedValueOnce(
      new PluginCallError(code, "boom", "seerr", "conn-1"),
    );
    const svc = new MediaService("u1");
    await expect(
      svc.requestDownload({ tmdbId: "550", mediaType: "movie", serviceId: "conn-1:1" }),
    ).rejects.toMatchObject({ status: 502, code: "request.provider_failed" });
  });

  it("propagates non-mapped PluginCallError codes", async () => {
    dispatchToConnectionMock.mockRejectedValueOnce(
      new PluginCallError("plugin.token_expired", "expired", "seerr", "conn-1"),
    );
    const svc = new MediaService("u1");
    await expect(
      svc.requestDownload({ tmdbId: "550", mediaType: "movie", serviceId: "conn-1:1" }),
    ).rejects.toThrow(/expired/);
  });

  it("throws 502 when plugin returns success:false", async () => {
    dispatchToConnectionMock.mockResolvedValueOnce({ success: false, message: "no good" });
    const svc = new MediaService("u1");
    await expect(
      svc.requestDownload({ tmdbId: "550", mediaType: "movie", serviceId: "conn-1:1" }),
    ).rejects.toMatchObject({ status: 502, code: "request.provider_failed" });
  });

  it("returns null requestId when plugin reports success without id", async () => {
    dispatchToConnectionMock.mockResolvedValueOnce({ success: true });
    const svc = new MediaService("u1");
    const result = await svc.requestDownload({
      tmdbId: "550",
      mediaType: "movie",
      serviceId: "conn-1:1",
    });
    expect(result).toEqual({ requestId: null });
  });
});

// Reference HttpError so the import isn't dropped by the formatter.
void HttpError;
