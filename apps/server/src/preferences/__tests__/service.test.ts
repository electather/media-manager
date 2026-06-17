import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const findJobEntryMock = vi.fn();
vi.mock("../../jobs", () => ({
  anyRunning: vi.fn(() => false),
  find: findJobEntryMock,
}));

vi.mock("../../jobs/history", () => ({
  latestRun: vi.fn(),
}));

vi.mock("../internal/catalog-provider", () => ({
  CatalogPreferenceProvider: vi.fn(),
}));

vi.mock("../internal/media-provider", () => ({
  MediaServicePreferenceProvider: vi.fn(),
}));

vi.mock("../internal/engine", () => ({
  PreferenceEngine: vi.fn(),
}));

vi.mock("../../catalog", () => ({
  getCatalogService: vi.fn(() => ({})),
}));

vi.mock("../internal/feedback-log", () => ({
  feedbackLog: { record: vi.fn() },
}));

vi.mock("../jobs/incremental-handle", () => ({
  triggerIncremental: vi.fn(),
}));

vi.mock("../repo", () => ({
  listUserIdsWithFeedbackSince: vi.fn(),
}));

vi.mock("../internal/rebuild-row-source", () => ({
  listUsersNeedingRebuild: vi.fn(),
  listUsersNeedingDailyRebuild: vi.fn(),
}));

vi.mock("../internal/profile-storage", () => ({
  profileStorage: { read: vi.fn(), write: vi.fn() },
}));

const { PreferencesService, resetPreferencesServiceForTest } = await import("../service");
const { JobNotRegisteredError, JobNotTriggerableError } = await import("../errors");

describe("PreferencesService.triggerManualRebuild", () => {
  let service: InstanceType<typeof PreferencesService>;
  const meta = { triggeredBy: "user" as const, triggeredByUserId: "u1" };

  beforeEach(() => {
    resetPreferencesServiceForTest();
    findJobEntryMock.mockReset();
    service = new PreferencesService();
  });

  it("throws JobNotRegisteredError when the job is not in the registry", async () => {
    findJobEntryMock.mockReturnValue(undefined);

    await expect(service.triggerManualRebuild({ userId: "u1" }, meta)).rejects.toBeInstanceOf(
      JobNotRegisteredError,
    );
  });

  it("throws JobNotTriggerableError when the entry has the wrong kind", async () => {
    // The entry exists but its kind is not "triggerable" (e.g. a scheduled job
    // was mistakenly registered under this id).
    findJobEntryMock.mockReturnValue({ kind: "scheduled", triggerFromApi: undefined });

    await expect(service.triggerManualRebuild({ userId: "u1" }, meta)).rejects.toBeInstanceOf(
      JobNotTriggerableError,
    );
  });

  it("throws JobNotTriggerableError when kind is correct but triggerFromApi is absent", async () => {
    // registerTriggerable always sets triggerFromApi, so this state is not
    // reachable through the public registration API. The branch is defensive,
    // and this test pins the contract in case a future entry is constructed by
    // other means.
    findJobEntryMock.mockReturnValue({ kind: "triggerable", triggerFromApi: undefined });

    await expect(service.triggerManualRebuild({ userId: "u1" }, meta)).rejects.toBeInstanceOf(
      JobNotTriggerableError,
    );
  });

  it("delegates to triggerFromApi when entry is well-formed", async () => {
    const triggerFromApi = vi.fn().mockResolvedValue({ runId: "r1", result: "ok" });
    findJobEntryMock.mockReturnValue({ kind: "triggerable", triggerFromApi });

    const result = await service.triggerManualRebuild({ userId: "u1" }, meta);

    expect(triggerFromApi).toHaveBeenCalledExactlyOnceWith({ userId: "u1" }, meta);
    expect(result).toEqual({ runId: "r1", result: "ok" });
  });
});
