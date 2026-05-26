import { describe, expect, it, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(import.meta.dirname, "../jobs/sync-plugin-watchlist.ts");

vi.mock("../../jobs/scheduled-per-row", () => ({
  registerScheduledPerRow: vi.fn(),
}));
vi.mock("../../media", () => ({
  MediaService: vi.fn(function MediaService() {
    return {};
  }),
  listSeededUserIds: vi.fn().mockResolvedValue([{ userId: "u1" }, { userId: "u2" }]),
}));
vi.mock("../../catalog", () => ({
  getCatalogService: () => ({}),
}));
vi.mock("../service", () => ({
  syncFromPlugins: vi.fn().mockResolvedValue({ added: 0, partial: false }),
}));

const { registerScheduledPerRow } = await import("../../jobs/scheduled-per-row");
const mediaModule = await import("../../media");
const service = await import("../service");
const { registerSyncPluginWatchlist, WATCHLIST_SYNC_JOB_ID } =
  await import("../jobs/sync-plugin-watchlist");

describe("watchlist sync-plugin job", () => {
  it("registers with the 6-hourly cron schedule", () => {
    registerSyncPluginWatchlist();
    expect(registerScheduledPerRow).toHaveBeenCalledTimes(1);
    const opts = (registerScheduledPerRow as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(opts.id).toBe(WATCHLIST_SYNC_JOB_ID);
    expect(opts.schedule).toBe("0 */6 * * *");
    expect(opts.continueOnRowError).toBe(true);
  });

  it("rowSource pulls seeded users via the repo", async () => {
    const opts = (registerScheduledPerRow as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const rows = await opts.rowSource();
    expect(rows).toEqual([{ userId: "u1" }, { userId: "u2" }]);
    expect(mediaModule.listSeededUserIds).toHaveBeenCalledTimes(1);
  });

  it("handler invokes service.syncFromPlugins with the row's user id", async () => {
    const opts = (registerScheduledPerRow as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    await opts.handler({}, { userId: "u1" });
    expect(service.syncFromPlugins).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1" }));
  });

  it("registration file declares continueOnRowError so one user does not stop others", () => {
    const text = readFileSync(FILE, "utf8");
    expect(text).toContain("continueOnRowError: true");
  });
});
