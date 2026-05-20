import { describe, it, expect, vi } from "vite-plus/test";

// Captures of the options registerScheduledPerRow / registerScheduled receive.
const perRowCalls: Array<Record<string, unknown>> = [];
const globalCalls: Array<Record<string, unknown>> = [];

vi.mock("../scheduled-per-row", () => ({
  registerScheduledPerRow: vi.fn((opts: Record<string, unknown>) => {
    perRowCalls.push(opts);
  }),
}));

vi.mock("../scheduled", () => ({
  registerScheduled: vi.fn((opts: Record<string, unknown>) => {
    globalCalls.push(opts);
  }),
}));

vi.mock("../../db/queries", () => ({
  selectEnabledPlugins: async () => [
    {
      id: "seerr",
      manifest: JSON.stringify({
        name: "Seerr",
        jobs: [
          {
            id: "requestStatusSync",
            schedule: "*/5 * * * *",
            handler: "syncStatuses",
            perConnection: true,
            perRowTimeoutSec: 120,
          },
        ],
      }),
    },
    {
      id: "global-plugin",
      manifest: JSON.stringify({
        name: "Global Plugin",
        jobs: [{ id: "tick", schedule: "0 * * * *", handler: "tick" }],
      }),
    },
  ],
}));

vi.mock("../../db/client", () => ({
  getDb: () => ({}),
}));

vi.mock("../../plugin-runtime", () => ({
  capabilityRegistry: { get: () => undefined },
  pluginRuntime: { buildJobContext: async () => ({}) },
}));

vi.mock("../../crypto/helpers", () => ({
  encryptJson: async () => ({ data: "", iv: "" }),
  decryptJson: async () => null,
}));

const { registerAllPluginJobs } = await import("../plugin-jobs");

describe("plugin-jobs registration", () => {
  it("forwards perRowTimeoutSec from a perConnection manifest job to registerScheduledPerRow", async () => {
    // Regression: the per-row override was added to fix Seerr's 60s default
    // triggering 24 captured timeouts in prod. The value must flow end-to-end
    // from manifest → DeclaredPluginJob → registerScheduledPerRow opts.
    perRowCalls.length = 0;
    globalCalls.length = 0;

    await registerAllPluginJobs();

    const seerrCall = perRowCalls.find((c) => c.id === "plugin.seerr.requestStatusSync");
    expect(seerrCall).toBeDefined();
    expect(seerrCall?.perRowTimeoutSec).toBe(120);
  });

  it("does not propagate perRowTimeoutSec to global (non-perConnection) jobs", async () => {
    // Even if a manifest sneaks the field onto a global job, the extractor
    // drops it so registerScheduled never receives a meaningless override.
    perRowCalls.length = 0;
    globalCalls.length = 0;

    await registerAllPluginJobs();

    const globalCall = globalCalls.find((c) => c.id === "plugin.global-plugin.tick");
    expect(globalCall).toBeDefined();
    expect(globalCall?.perRowTimeoutSec).toBeUndefined();
  });
});
