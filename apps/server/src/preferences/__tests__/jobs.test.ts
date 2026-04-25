import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { consola } from "consola";

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

vi.mock("consola", () => ({
  consola: {
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { registerPreferenceJobs, PREFERENCE_MANUAL_REBUILD_JOB_ID } = await import("../jobs");
const { registerTriggerable } = await import("../../jobs/triggerable");
const { getPreferenceEngine } = await import("../index");

describe("PREFERENCE_MANUAL_REBUILD_JOB_ID handler", () => {
  let triggerableHandler: any;
  let mockEngine: any;
  const mockAbortSignal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEngine = {
      rebuildProfile: vi.fn(),
    };
    vi.mocked(getPreferenceEngine).mockReturnValue(mockEngine);

    registerPreferenceJobs();

    // Find the handler passed to registerTriggerable
    const calls = vi.mocked(registerTriggerable).mock.calls;
    const manualRebuildCall = calls.find((call) => call[0].id === PREFERENCE_MANUAL_REBUILD_JOB_ID);
    expect(manualRebuildCall).toBeDefined();
    triggerableHandler = manualRebuildCall![0].handler;
  });

  it("throws if userId is missing", async () => {
    await expect(triggerableHandler({ abortSignal: mockAbortSignal }, {})).rejects.toThrow(
      "userId is required",
    );
    expect(consola.warn).toHaveBeenCalledWith(
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

    const result = await triggerableHandler({ abortSignal: mockAbortSignal }, { userId: "u1" });

    expect(result.warnings).toContain("Profile for movie was rebuilt with 0 sample size");
    // The else-if branch means only the sampleSize warning fires when sampleSize is 0.
    expect(result.warnings).not.toContain(
      "Profile for movie has low confidence (insufficient data points)",
    );
    expect(mockEngine.rebuildProfile).toHaveBeenCalledWith("u1", "movie", mockAbortSignal);
    expect(mockEngine.rebuildProfile).toHaveBeenCalledWith("u1", "tv", mockAbortSignal);
    expect(mockEngine.rebuildProfile).toHaveBeenCalledWith("u1", "combined", mockAbortSignal);
    expect(consola.warn).toHaveBeenCalledWith(
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

    const result = await triggerableHandler({ abortSignal: mockAbortSignal }, { userId: "u1" });

    expect(result.warnings).toContain(
      "Profile for tv has low confidence (insufficient data points)",
    );
    expect(result.warnings).not.toContain(
      "Profile for movie has low confidence (insufficient data points)",
    );
    expect(consola.warn).toHaveBeenCalledWith(
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

    const result = await triggerableHandler({ abortSignal: mockAbortSignal }, { userId: "u1" });

    expect(result.warnings).toEqual([]);
    expect(consola.success).toHaveBeenCalledWith(
      expect.stringContaining("Completed successfully for user u1"),
      expect.any(Object),
    );
    expect(consola.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Completed with warnings"),
    );
  });

  it("catches, logs, and re-throws errors from rebuildProfile", async () => {
    const error = new Error("Database offline");
    mockEngine.rebuildProfile.mockRejectedValue(error);

    await expect(
      triggerableHandler({ abortSignal: mockAbortSignal }, { userId: "u1" }),
    ).rejects.toThrow("Database offline");

    expect(consola.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed for user u1"),
      expect.objectContaining({ error: "Database offline" }),
    );
  });
});
