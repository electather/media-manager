import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../jobs/triggerable", () => ({
  registerTriggerable: vi.fn(),
}));

vi.mock("../../jobs/scheduled-per-row", () => ({
  registerScheduledPerRow: vi.fn(),
}));

vi.mock("../../jobs/coalesced", () => ({
  registerCoalesced: vi.fn(),
}));

vi.mock("../index", () => ({
  getPreferenceEngine: vi.fn(),
}));

vi.mock("../../catalog", () => ({
  getCatalogService: vi.fn(() => ({})),
}));

vi.mock("../../catalog/jobs/recommendation-build", () => ({
  writeRecommendationsForUser: vi.fn(async () => undefined),
}));

const consolaMock = {
  info: vi.fn(),
  warn: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
vi.mock("consola", () => ({
  default: consolaMock,
  consola: consolaMock,
}));

const { registerPreferenceJobs, PREFERENCE_MANUAL_REBUILD_JOB_ID } = await import("../jobs");
const { registerTriggerable } = await import("../../jobs/triggerable");
const { getPreferenceEngine } = await import("../index");

describe("PREFERENCE_MANUAL_REBUILD_JOB_ID handler", () => {
  let triggerableHandler: any;
  let mockEngine: any;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
  let mockCtx: { abortSignal: AbortSignal; logger: typeof mockLogger };
  const mockAbortSignal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEngine = {
      rebuildProfile: vi.fn(),
    };
    vi.mocked(getPreferenceEngine).mockReturnValue(mockEngine);

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    mockCtx = { abortSignal: mockAbortSignal, logger: mockLogger };

    registerPreferenceJobs();

    // Find the handler passed to registerTriggerable
    const calls = vi.mocked(registerTriggerable).mock.calls;
    const manualRebuildCall = calls.find((call) => call[0].id === PREFERENCE_MANUAL_REBUILD_JOB_ID);
    expect(manualRebuildCall).toBeDefined();
    triggerableHandler = manualRebuildCall![0].handler;
  });

  it("throws if userId is missing", async () => {
    await expect(triggerableHandler(mockCtx, {})).rejects.toThrow("userId is required");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("userId is required in input"),
    );
  });

  it("adds warning if sampleSize is 0", async () => {
    mockEngine.rebuildProfile.mockImplementation(async (userId: string, mediaType: string) => ({
      userId,
      mediaType,
      sampleSize: 0,
      confidence: "low",
    }));

    const result = await triggerableHandler(mockCtx, { userId: "u1" });

    expect(result.warnings).toContain("Profile for movie was rebuilt with 0 sample size");
    // The else-if branch means only the sampleSize warning fires when sampleSize is 0.
    expect(result.warnings).not.toContain(
      "Profile for movie has low confidence (insufficient data points)",
    );
    expect(mockEngine.rebuildProfile).toHaveBeenCalledWith("u1", "movie", mockAbortSignal);
    expect(mockEngine.rebuildProfile).toHaveBeenCalledWith("u1", "tv", mockAbortSignal);
    expect(mockEngine.rebuildProfile).toHaveBeenCalledWith("u1", "combined", mockAbortSignal);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Completed with warnings for user u1"),
      expect.any(Object),
    );
  });

  it("adds warning if confidence is low and sampleSize > 0", async () => {
    mockEngine.rebuildProfile.mockImplementation(async (userId: string, mediaType: string) => {
      if (mediaType === "tv") {
        return { userId, mediaType, sampleSize: 5, confidence: "low" };
      }
      return { userId, mediaType, sampleSize: 50, confidence: "high" };
    });

    const result = await triggerableHandler(mockCtx, { userId: "u1" });

    expect(result.warnings).toContain(
      "Profile for tv has low confidence (insufficient data points)",
    );
    expect(result.warnings).not.toContain(
      "Profile for movie has low confidence (insufficient data points)",
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Completed with warnings for user u1"),
      expect.any(Object),
    );
  });

  it("returns empty warnings array on success", async () => {
    mockEngine.rebuildProfile.mockImplementation(async (userId: string, mediaType: string) => ({
      userId,
      mediaType,
      sampleSize: 100,
      confidence: "high",
    }));

    const result = await triggerableHandler(mockCtx, { userId: "u1" });

    expect(result.warnings).toEqual([]);
    expect(mockLogger.success).toHaveBeenCalledWith(
      expect.stringContaining("Completed successfully for user u1"),
      expect.any(Object),
    );
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Completed with warnings"),
    );
  });

  it("catches, logs, and re-throws errors from rebuildProfile", async () => {
    const error = new Error("Database offline");
    mockEngine.rebuildProfile.mockRejectedValue(error);

    await expect(triggerableHandler(mockCtx, { userId: "u1" })).rejects.toThrow("Database offline");

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed for user u1"),
      expect.objectContaining({ error: "Database offline" }),
    );
  });
});
