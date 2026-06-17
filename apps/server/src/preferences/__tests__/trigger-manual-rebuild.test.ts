import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

// The catalog, jobs, and DB-backed internals all pull in native dependencies
// (drizzle-orm/libsql, croner) that are unavailable in the unit-test environment.
// We mock every module at the boundary used by the service under test.

vi.mock("../../catalog", () => ({
  getCatalogService: vi.fn(() => ({})),
}));

const findJobEntryMock = vi.fn();
vi.mock("../../jobs", () => ({
  find: (...args: unknown[]) => findJobEntryMock(...args),
  anyRunning: (..._args: unknown[]) => false,
}));

vi.mock("../../jobs/history", () => ({
  latestRun: vi.fn(async () => null),
}));

vi.mock("../internal/catalog-provider", () => ({
  CatalogPreferenceProvider: vi.fn(),
}));

vi.mock("../internal/engine", () => ({
  PreferenceEngine: vi.fn(() => ({})),
}));

vi.mock("../internal/feedback-log", () => ({
  feedbackLog: { record: vi.fn(), readAllForUser: vi.fn(async () => []) },
}));

vi.mock("../internal/media-provider", () => ({
  MediaServicePreferenceProvider: vi.fn(),
}));

vi.mock("../internal/profile-storage", () => ({
  profileStorage: { read: vi.fn(async () => null), write: vi.fn(async () => {}) },
}));

vi.mock("../repo", () => ({
  listUserIdsWithFeedbackSince: vi.fn(async () => []),
}));

vi.mock("../internal/rebuild-row-source", () => ({
  listUsersNeedingRebuild: vi.fn(async () => []),
  listUsersNeedingDailyRebuild: vi.fn(async () => []),
}));

vi.mock("../jobs/incremental-handle", () => ({
  triggerIncremental: vi.fn(),
}));

const { getPreferencesService, resetPreferencesServiceForTest } = await import("../service");
const { JobNotRegisteredError, JobNotTriggerableError } = await import("../errors");

/**
 * Unit tests for the `triggerManualRebuild` guard clauses introduced in #671.
 * Each branch now throws a distinct error so callers can distinguish "job not
 * yet registered" (cold worker) from "job registered with the wrong kind"
 * (misconfiguration).
 */
describe("PreferencesService.triggerManualRebuild guard clauses", () => {
  const meta = { triggeredBy: "user" as const, triggeredByUserId: "u1" };

  beforeEach(() => {
    resetPreferencesServiceForTest();
    findJobEntryMock.mockReset();
  });

  it("throws JobNotRegisteredError when the job is not in the registry", async () => {
    findJobEntryMock.mockReturnValue(undefined);

    await expect(
      getPreferencesService().triggerManualRebuild({ userId: "u1" }, meta),
    ).rejects.toThrow(JobNotRegisteredError);
  });

  it("throws JobNotTriggerableError when the entry has the wrong kind", async () => {
    // A scheduled entry for the same job id should produce JobNotTriggerableError,
    // not JobNotRegisteredError, because the job IS registered — just with the
    // wrong kind. This distinction is the fix introduced in #671.
    findJobEntryMock.mockReturnValue({
      id: "feature.preference.rebuild",
      name: "Preference rebuild",
      kind: "scheduled",
      dispose: vi.fn(),
    });

    await expect(
      getPreferencesService().triggerManualRebuild({ userId: "u1" }, meta),
    ).rejects.toThrow(JobNotTriggerableError);
  });

  it("throws JobNotTriggerableError when the entry is triggerable but has no triggerFromApi handler", async () => {
    findJobEntryMock.mockReturnValue({
      id: "feature.preference.rebuild",
      name: "Preference rebuild",
      kind: "triggerable",
      dispose: vi.fn(),
      // triggerFromApi intentionally absent.
    });

    await expect(
      getPreferencesService().triggerManualRebuild({ userId: "u1" }, meta),
    ).rejects.toThrow(JobNotTriggerableError);
  });

  it("delegates to triggerFromApi when entry is fully configured", async () => {
    const triggerFromApi = vi.fn(async () => ({ runId: "run-1", result: {} }));
    findJobEntryMock.mockReturnValue({
      id: "feature.preference.rebuild",
      name: "Preference rebuild",
      kind: "triggerable",
      dispose: vi.fn(),
      triggerFromApi,
    });

    const result = await getPreferencesService().triggerManualRebuild({ userId: "u1" }, meta);

    expect(triggerFromApi).toHaveBeenCalledWith({ userId: "u1" }, meta);
    expect(result).toEqual({ runId: "run-1", result: {} });
  });
});
