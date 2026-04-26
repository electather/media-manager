import { describe, it, expect } from "vite-plus/test";
import { makeTestContext, createTestNotificationContext } from "../index";

describe("notification test helpers", () => {
  it("makeTestContext has no-op notify by default", async () => {
    const ctx = makeTestContext();
    await expect(
      ctx.notify({
        type: "job.run.failed",
        category: "system",
        severity: "error",
        audience: { kind: "admin", permission: "admin:server" },
        payload: { jobId: "1", runId: "1", error: "test" },
      }),
    ).resolves.toBeUndefined();
  });

  it("createTestNotificationContext captures emitted notifications", async () => {
    const ctx = createTestNotificationContext();

    const event1 = {
      type: "job.run.failed" as const,
      category: "system" as const,
      severity: "error" as const,
      audience: { kind: "admin" as const, permission: "admin:server" as const },
      payload: { jobId: "1", runId: "1", error: "test error" },
    };

    const event2 = {
      type: "connection.auth.expired" as const,
      category: "auth" as const,
      severity: "warn" as const,
      audience: { kind: "user" as const, userId: "user-123" },
      payload: { connectionId: "conn-1", pluginId: "plex" },
    };

    await ctx.notify(event1);
    await ctx.notify(event2);

    expect(ctx.emittedNotifications).toHaveLength(2);
    expect(ctx.emittedNotifications[0]).toEqual(event1);
    expect(ctx.emittedNotifications[1]).toEqual(event2);
  });

  it("createTestNotificationContext inherits other test context features", async () => {
    const ctx = createTestNotificationContext({
      responses: [
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ],
    });

    const res = await ctx.fetch("https://example.com/api");
    expect(res.status).toBe(200);
    expect((ctx as any).calls).toHaveLength(1);
    expect((ctx as any).calls[0].url).toBe("https://example.com/api");
  });

  it("createTestNotificationContext allows notify override", async () => {
    let captured: unknown;
    const ctx = createTestNotificationContext({
      overrides: {
        notify: async (event) => {
          captured = event;
        },
      },
    });

    const event = {
      type: "media.request.available" as const,
      category: "media" as const,
      severity: "info" as const,
      audience: { kind: "user" as const, userId: "user-1" },
      payload: {
        requestId: "req-1",
        mediaId: "m-1",
        title: "Test",
        posterUrl: "url",
      },
    };

    await ctx.notify(event);
    expect(captured).toEqual(event);
  });
});
