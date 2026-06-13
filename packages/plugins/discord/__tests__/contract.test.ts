import { describe, expect, it } from "vite-plus/test";
import { isPluginError, validatePluginModule } from "@nama/plugin-sdk";
import { jsonRes, makeTestContext, statusRes } from "@nama/plugin-sdk/testing";
import type { NotificationEvent } from "@nama/shared/notifications";
import discordPlugin from "../src/plugin";

const channelConfig = {
  webhookUrl: "https://discord.com/api/webhooks/123/abc",
};

const sampleEvent: NotificationEvent = {
  id: "evt-1",
  occurredAt: "2026-04-25T10:00:00.000Z",
  type: "system.error",
  category: "system",
  severity: "error",
  audience: { kind: "admin", permission: "admin:server" },
  payload: { errorSource: "scheduler", message: "boom" },
};

const message = {
  title: "System Error",
  body: "scheduler: boom",
  severity: "error" as const,
  category: "system" as const,
};

function readBody(call: { init?: RequestInit }) {
  const body = call.init?.body;
  return JSON.parse(typeof body === "string" ? body : "{}") as Record<string, unknown>;
}

describe("discord plugin passes loader validation", () => {
  it("validates against the manifest + capability catalog", () => {
    expect(validatePluginModule(discordPlugin)).toBeDefined();
  });
});

describe("discord notificationDelivery contract", () => {
  it("deliver: POSTs an embed payload to the webhook with wait=true", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({ id: "msg-77" })] });
    const out = await discordPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: sampleEvent,
      channelConfig,
    });
    expect(ctx.calls[0]?.url).toBe("https://discord.com/api/webhooks/123/abc?wait=true");
    expect(ctx.calls[0]?.init?.method).toBe("POST");
    const body = readBody(ctx.calls[0]!);
    const embed = (body.embeds as Array<Record<string, unknown>>)[0]!;
    expect(embed.title).toBe("System Error");
    expect(embed.description).toBe("scheduler: boom");
    expect(embed.color).toBe(0xef4444);
    expect(out).toEqual({ providerMessageId: "msg-77" });
  });

  it("deliver: appends &wait=true when webhookUrl already has a query string", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({})] });
    await discordPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: sampleEvent,
      channelConfig: { webhookUrl: "https://discord.com/api/webhooks/123/abc?thread_id=42" },
    });
    expect(ctx.calls[0]?.url).toBe(
      "https://discord.com/api/webhooks/123/abc?thread_id=42&wait=true",
    );
  });

  it("testDelivery: GETs the webhook URL and reports ok on 2xx", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({ id: "wh1", token: "..." })] });
    const out = await discordPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(ctx.calls[0]?.url).toBe("https://discord.com/api/webhooks/123/abc");
    expect(ctx.calls[0]?.init?.method).toBe("GET");
    expect(out).toEqual({ ok: true });
  });

  it("testDelivery: 404 → ok false", async () => {
    const ctx = makeTestContext({ responses: [statusRes(404)] });
    const out = await discordPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(out.ok).toBe(false);
  });
});

describe("discord notificationDelivery error semantics", () => {
  it("5xx: throws retryable plugin.upstream_error", async () => {
    const ctx = makeTestContext({
      responses: [statusRes(503, JSON.stringify({ message: "down" }))],
    });
    await expect(
      discordPlugin.capabilities.notificationDelivery!.deliver(ctx, {
        message,
        event: sampleEvent,
        channelConfig,
      }),
    ).rejects.toMatchObject({
      name: "PluginError",
      code: "plugin.upstream_error",
      retryable: true,
    });
  });

  it("429 with retry_after carries retryAfterMs", async () => {
    const ctx = makeTestContext({
      responses: [
        new Response(JSON.stringify({ retry_after: 1.5, message: "slow" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      ],
    });
    try {
      await discordPlugin.capabilities.notificationDelivery!.deliver(ctx, {
        message,
        event: sampleEvent,
        channelConfig,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(isPluginError(err)).toBe(true);
      expect((err as { code: string }).code).toBe("plugin.rate_limited");
      expect((err as { retryable: boolean }).retryable).toBe(true);
      expect((err as { retryAfterMs: number }).retryAfterMs).toBe(1500);
    }
  });

  it("429: retry_after JSON body above 1h cap clamps to 3_600_000ms", async () => {
    const ctx = makeTestContext({
      responses: [
        new Response(JSON.stringify({ retry_after: 7200, message: "slow" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      ],
    });
    await expect(
      discordPlugin.capabilities.notificationDelivery!.deliver(ctx, {
        message,
        event: sampleEvent,
        channelConfig,
      }),
    ).rejects.toMatchObject({
      code: "plugin.rate_limited",
      retryable: true,
      retryAfterMs: 3_600_000,
    });
  });

  it("429: retry_after JSON body at exactly 3600s yields 3_600_000ms boundary", async () => {
    const ctx = makeTestContext({
      responses: [
        new Response(JSON.stringify({ retry_after: 3600 }), {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
      ],
    });
    await expect(
      discordPlugin.capabilities.notificationDelivery!.deliver(ctx, {
        message,
        event: sampleEvent,
        channelConfig,
      }),
    ).rejects.toMatchObject({
      code: "plugin.rate_limited",
      retryAfterMs: 3_600_000,
    });
  });

  it("429: retry-after header above cap clamps to 3_600_000ms", async () => {
    const ctx = makeTestContext({
      responses: [
        new Response("null", {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "7200" },
        }),
      ],
    });
    await expect(
      discordPlugin.capabilities.notificationDelivery!.deliver(ctx, {
        message,
        event: sampleEvent,
        channelConfig,
      }),
    ).rejects.toMatchObject({
      code: "plugin.rate_limited",
      retryAfterMs: 3_600_000,
    });
  });

  it("401: throws non-retryable plugin.bad_credentials", async () => {
    const ctx = makeTestContext({
      responses: [statusRes(401, JSON.stringify({ message: "no" }))],
    });
    await expect(
      discordPlugin.capabilities.notificationDelivery!.deliver(ctx, {
        message,
        event: sampleEvent,
        channelConfig,
      }),
    ).rejects.toMatchObject({
      name: "PluginError",
      code: "plugin.bad_credentials",
      retryable: false,
    });
  });
});
