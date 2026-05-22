import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { PluginError } from "@ent-mcp/plugin-sdk";

// vi.mock factory bodies are hoisted above top-level const declarations, so
// referencing a regular `const` mock from inside the factory races the TDZ.
// vi.hoisted runs alongside the mock hoist, keeping the reference valid.
const captureErrorMock = vi.hoisted(() =>
  vi.fn<(err: unknown, meta: Record<string, unknown>) => Promise<string>>(async () => "diag-id"),
);

vi.mock("../../diagnostics/capture", () => ({
  captureError: captureErrorMock,
}));

// ─── invokePerConnectionHandler ──────────────────────────────────────────────

interface SetValues {
  status?: string;
  errorMessage?: string | null;
  encryptedCredentials?: string;
  credentialsIv?: string;
  lastVerifiedAt?: number;
  updatedAt?: number;
}

const setCalls: SetValues[] = [];

const emitMock = vi.fn<(name: string, schema: unknown, payload: unknown) => Promise<void>>(
  async () => undefined,
);

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../db/client", () => ({
  getDb: () => ({
    update: () => ({
      set: (values: SetValues) => {
        setCalls.push(values);
        return { where: async () => undefined };
      },
    }),
  }),
}));

vi.mock("../../db/schema", () => ({
  serviceConnections: { id: "id" },
}));

vi.mock("../../crypto/helpers", () => ({
  decryptJson: async () => ({ token: "stale" }),
  encryptJson: async (value: unknown) => ({ iv: "iv", data: JSON.stringify(value) }),
}));

vi.mock("../../plugin-runtime", () => ({
  capabilityRegistry: { get: () => undefined },
  pluginRuntime: {
    buildJobContext: async () => ({ user: null, credentials: {}, userConfig: null }),
  },
}));

vi.mock("../events", () => ({
  emit: emitMock,
}));

// ─── registerAllPluginJobs ───────────────────────────────────────────────────

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

interface PluginRow {
  id: string;
  manifest: string;
}

const defaultPluginRows: PluginRow[] = [
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
];

let pluginRows: PluginRow[] = defaultPluginRows;

vi.mock("../../db/queries", () => ({
  selectEnabledPlugins: async () => pluginRows,
}));

const { invokePerConnectionHandler, registerAllPluginJobs } = await import("../plugin-jobs");

interface TestJob {
  pluginId: string;
  pluginName: string;
  id: string;
  schedule: string;
  handler: string;
  perConnection: boolean;
}

function makeJob(pluginId = "trakt"): TestJob {
  return {
    pluginId,
    pluginName: pluginId,
    id: "refresh-tokens",
    schedule: "0 * * * *",
    handler: "refreshTokens",
    perConnection: true,
  };
}

interface TestRow {
  id: string;
  userId: string;
  pluginId: string;
  userConfig: string | null;
  encryptedCredentials: string | null;
  credentialsIv: string | null;
  status: "connected" | "expired" | "error" | "disconnected";
  retryAfter: number | null;
}

function makeRow(id = "conn-1", status: TestRow["status"] = "connected"): TestRow {
  return {
    id,
    userId: "user-1",
    pluginId: "trakt",
    userConfig: null,
    encryptedCredentials: "enc",
    credentialsIv: "iv",
    status,
    retryAfter: null,
  };
}

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as import("consola").ConsolaInstance;

beforeEach(() => {
  setCalls.length = 0;
  emitMock.mockClear();
  captureErrorMock.mockClear();
  pluginRows = defaultPluginRows;
});

describe("invokePerConnectionHandler", () => {
  it("marks status 'expired' and emits auth-expired when handler throws plugin.token_expired", async () => {
    const job = makeJob();
    const row = makeRow("conn-42");
    const handler = async () => {
      throw new PluginError("plugin.token_expired", "refresh revoked");
    };

    await expect(
      invokePerConnectionHandler({ job, row, handler, logger: noopLogger }),
    ).rejects.toThrow("refresh revoked");

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.status).toBe("expired");
    expect(setCalls[0]?.errorMessage).toBe("refresh revoked");

    expect(emitMock).toHaveBeenCalledTimes(1);
    const [name, , payload] = emitMock.mock.calls[0]!;
    expect(name).toBe("media.connection.auth-expired");
    expect(payload).toEqual({
      connectionId: "conn-42",
      pluginId: "trakt",
      userId: "user-1",
    });
  });

  it("marks status 'error' and does not emit when handler throws a generic error", async () => {
    const job = makeJob();
    const row = makeRow();
    const handler = async () => {
      throw new Error("network blew up");
    };

    await expect(
      invokePerConnectionHandler({ job, row, handler, logger: noopLogger }),
    ).rejects.toThrow("network blew up");

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.status).toBe("error");
    expect(setCalls[0]?.errorMessage).toBe("network blew up");
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("does not propagate an emit failure to the caller", async () => {
    const job = makeJob();
    const row = makeRow();
    const handler = async () => {
      throw new PluginError("plugin.token_expired", "refresh revoked");
    };
    emitMock.mockRejectedValueOnce(new Error("emit boom"));

    await expect(
      invokePerConnectionHandler({ job, row, handler, logger: noopLogger }),
    ).rejects.toThrow("refresh revoked");
    // The status write must run even when the emit fails, so the connection
    // card still shows "expired" + the re-auth CTA.
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.status).toBe("expired");
    expect(setCalls[0]?.errorMessage).toBe("refresh revoked");
  });

  it("does not re-emit auth-expired when the row is already expired", async () => {
    // Per-row job iterates every connection for the plugin every tick. Without
    // this transition guard, a revoked refresh token would spam notifications
    // every scheduled run forever.
    const job = makeJob();
    const row = makeRow("conn-stuck", "expired");
    const handler = async () => {
      throw new PluginError("plugin.token_expired", "still revoked");
    };

    await expect(
      invokePerConnectionHandler({ job, row, handler, logger: noopLogger }),
    ).rejects.toThrow("still revoked");

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.status).toBe("expired");
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("clears stale error state on a successful handler return", async () => {
    const job = makeJob();
    const row = makeRow("conn-9", "error");
    const handler = async () => ({ token: "fresh" });

    await invokePerConnectionHandler({ job, row, handler, logger: noopLogger });

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.encryptedCredentials).toBe(JSON.stringify({ token: "fresh" }));
    expect(setCalls[0]?.credentialsIv).toBe("iv");
    expect(setCalls[0]?.status).toBe("connected");
    expect(setCalls[0]?.errorMessage).toBeNull();
    expect(setCalls[0]?.lastVerifiedAt).toBeDefined();
    expect(emitMock).not.toHaveBeenCalled();
  });
});

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

  it("skips a row whose manifest is not valid JSON and still registers the rest (#447)", async () => {
    // Regression for #453 / #460: a single corrupted manifest threw inside
    // listAllPluginJobs and aborted registration of every other plugin's jobs
    // at startup.
    perRowCalls.length = 0;
    globalCalls.length = 0;
    pluginRows = [{ id: "broken", manifest: "{not-json" }, defaultPluginRows[1]!];

    const count = await registerAllPluginJobs();

    expect(count).toBe(1);
    expect(globalCalls.find((c) => c.id === "plugin.global-plugin.tick")).toBeDefined();
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    expect(captureErrorMock.mock.calls[0]![1]).toMatchObject({
      code: "cron.manifest_invalid",
      pluginId: "broken",
      source: "cron",
      context: { stage: "json-parse" },
    });
  });

  it("skips a row whose manifest fails schema validation and registers neighbors (#447)", async () => {
    // perRowTimeoutSec must be a positive int ≤ 1800 per manifestJobEntrySchema.
    // A bad value used to flow through unchecked because the parser only cast
    // the JSON instead of running it through the shared schema.
    perRowCalls.length = 0;
    globalCalls.length = 0;
    pluginRows = [
      {
        id: "bad-timeout",
        manifest: JSON.stringify({
          name: "Bad Timeout",
          jobs: [
            {
              id: "refresh",
              schedule: "*/5 * * * *",
              handler: "refresh",
              perConnection: true,
              perRowTimeoutSec: -42,
            },
          ],
        }),
      },
      defaultPluginRows[0]!,
      defaultPluginRows[1]!,
    ];

    const count = await registerAllPluginJobs();

    expect(count).toBe(2);
    expect(perRowCalls.find((c) => c.id === "plugin.seerr.requestStatusSync")).toBeDefined();
    expect(globalCalls.find((c) => c.id === "plugin.global-plugin.tick")).toBeDefined();
    expect(perRowCalls.find((c) => c.id === "plugin.bad-timeout.refresh")).toBeUndefined();
    expect(captureErrorMock).toHaveBeenCalledTimes(1);
    expect(captureErrorMock.mock.calls[0]![1]).toMatchObject({
      code: "cron.manifest_invalid",
      pluginId: "bad-timeout",
      context: { stage: "schema-validate" },
    });
  });
});
