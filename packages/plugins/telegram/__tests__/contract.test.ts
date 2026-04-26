import { describe, expect, it } from "vite-plus/test";
import { isPluginError, validatePluginModule } from "@ent-mcp/plugin-sdk";
import { jsonRes, makeTestContext, statusRes } from "@ent-mcp/plugin-sdk/testing";
import type { NotificationEvent } from "@ent-mcp/shared/notifications";
import telegramPlugin from "../src/plugin";

const channelConfig = {
  botToken: "123:ABC",
  chatId: "987",
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

describe("telegram plugin passes loader validation", () => {
  it("validates against the manifest + capability catalog", () => {
    expect(validatePluginModule(telegramPlugin)).toBeDefined();
  });
});

describe("telegram notificationDelivery contract", () => {
  it("deliver: POSTs sendMessage to the bot endpoint", async () => {
    const ctx = makeTestContext({
      responses: [jsonRes({ ok: true, result: { message_id: 42 } })],
    });
    const out = await telegramPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: sampleEvent,
      channelConfig,
    });
    const call = ctx.calls[0]!;
    const init = call.init!;
    expect(call.url).toBe("https://api.telegram.org/bot123%3AABC/sendMessage");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const body = readBody(call);
    expect(body.chat_id).toBe("987");
    expect(body.parse_mode).toBe("MarkdownV2");
    expect(body.text).toContain("System Error");
    expect(out).toEqual({ providerMessageId: "42" });
  });

  it("testDelivery: GETs getMe and reports ok on 2xx", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({ ok: true, result: { id: 1 } })] });
    const out = await telegramPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(ctx.calls[0]?.url).toBe("https://api.telegram.org/bot123%3AABC/getMe");
    expect(out).toEqual({ ok: true });
  });

  it("testDelivery: 401 → ok false", async () => {
    const ctx = makeTestContext({ responses: [statusRes(401, "Unauthorized")] });
    const out = await telegramPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(out.ok).toBe(false);
  });
});

describe("telegram notificationDelivery error semantics", () => {
  it("5xx: throws retryable plugin.upstream_error", async () => {
    const ctx = makeTestContext({
      responses: [statusRes(503, JSON.stringify({ description: "down" }))],
    });
    await expect(
      telegramPlugin.capabilities.notificationDelivery!.deliver(ctx, {
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

  it("429 with parameters.retry_after carries retryAfterMs", async () => {
    const ctx = makeTestContext({
      responses: [
        new Response(
          JSON.stringify({
            ok: false,
            description: "Too Many Requests",
            parameters: { retry_after: 30 },
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
      ],
    });
    try {
      await telegramPlugin.capabilities.notificationDelivery!.deliver(ctx, {
        message,
        event: sampleEvent,
        channelConfig,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(isPluginError(err)).toBe(true);
      expect((err as { code: string }).code).toBe("plugin.rate_limited");
      expect((err as { retryable: boolean }).retryable).toBe(true);
      expect((err as { retryAfterMs: number }).retryAfterMs).toBe(30_000);
    }
  });

  it("401: throws non-retryable plugin.bad_credentials", async () => {
    const ctx = makeTestContext({
      responses: [statusRes(401, JSON.stringify({ description: "no" }))],
    });
    await expect(
      telegramPlugin.capabilities.notificationDelivery!.deliver(ctx, {
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
