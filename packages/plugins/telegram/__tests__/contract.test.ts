import { describe, expect, it } from "vite-plus/test";
import { isPluginError, validatePluginModule } from "@nama/plugin-sdk";
import { jsonRes, makeTestContext, statusRes } from "@nama/plugin-sdk/testing";
import type { NotificationEvent } from "@nama/shared/notifications";
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

  it("testDelivery: probes getMe + getChat then sends a real test message", async () => {
    const ctx = makeTestContext({
      responses: [
        jsonRes({ ok: true, result: { id: 1 } }),
        jsonRes({ ok: true, result: { id: 987, type: "private" } }),
        jsonRes({ ok: true, result: { message_id: 42 } }),
      ],
    });
    const out = await telegramPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(ctx.calls[0]?.url).toBe("https://api.telegram.org/bot123%3AABC/getMe");
    expect(ctx.calls[1]?.url).toBe("https://api.telegram.org/bot123%3AABC/getChat");
    expect(ctx.calls[2]?.url).toBe("https://api.telegram.org/bot123%3AABC/sendMessage");
    const sendBody = JSON.parse((ctx.calls[2]?.init?.body as string) ?? "{}") as Record<
      string,
      unknown
    >;
    expect(sendBody.chat_id).toBe("987");
    expect(typeof sendBody.text).toBe("string");
    expect((sendBody.text as string).toLowerCase()).toContain("test");
    expect(sendBody.disable_notification).toBe(true);
    expect(out).toEqual({ ok: true });
  });

  it("testDelivery: 401 from getMe → ok false (bot token rejected)", async () => {
    const ctx = makeTestContext({ responses: [statusRes(401, "Unauthorized")] });
    const out = await telegramPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(out).toEqual({ ok: false, message: "telegram bot token rejected" });
    // getChat must not be probed once the token is known bad.
    expect(ctx.calls.length).toBe(1);
  });

  it("testDelivery: getChat 'chat not found' → ok false with telegram's description", async () => {
    // Regression: with a valid bot token but invalid chat_id, the previous
    // implementation only ran getMe and reported ok. The user could save a
    // broken channel and only discover the failure on first delivery.
    const ctx = makeTestContext({
      responses: [
        jsonRes({ ok: true, result: { id: 1 } }),
        new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ],
    });
    const out = await telegramPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(out).toEqual({
      ok: false,
      message: "telegram: Bad Request: chat not found",
    });
  });

  it("testDelivery: getChat 403 (bot blocked) surfaces description", async () => {
    const ctx = makeTestContext({
      responses: [
        jsonRes({ ok: true, result: { id: 1 } }),
        new Response(JSON.stringify({ ok: false, description: "Forbidden: bot was kicked" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      ],
    });
    const out = await telegramPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain("Forbidden: bot was kicked");
  });

  it("testDelivery: getChat without parsable body falls back to status code", async () => {
    const ctx = makeTestContext({
      responses: [
        jsonRes({ ok: true, result: { id: 1 } }),
        new Response("plain text body", { status: 400 }),
      ],
    });
    const out = await telegramPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(out).toEqual({ ok: false, message: "telegram getChat 400" });
  });

  it("testDelivery: sendMessage failure surfaces telegram's description", async () => {
    // Regression: getMe + getChat can both pass while sendMessage fails (bot
    // can read the chat but cannot write — channel posting restricted,
    // supergroup topic locked, etc.). The probe must surface this so the
    // user sees a real error instead of a misleading success.
    const ctx = makeTestContext({
      responses: [
        jsonRes({ ok: true, result: { id: 1 } }),
        jsonRes({ ok: true, result: { id: 987, type: "channel" } }),
        new Response(JSON.stringify({ ok: false, description: "Forbidden: bot is not a member" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
      ],
    });
    const out = await telegramPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain("Forbidden: bot is not a member");
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
