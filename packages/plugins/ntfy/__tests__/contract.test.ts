import { describe, expect, it } from "vite-plus/test";
import { isPluginError, validatePluginModule } from "@ent-mcp/plugin-sdk";
import { jsonRes, makeTestContext, statusRes } from "@ent-mcp/plugin-sdk/testing";
import type { NotificationEvent } from "@ent-mcp/shared/notifications";
import ntfyPlugin from "../src/plugin";

const channelConfig = {
  serverUrl: "https://ntfy.example.com",
  topic: "alerts",
};

const sampleEvent: NotificationEvent = {
  id: "01J0000000000000000000",
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

describe("ntfy plugin passes loader validation", () => {
  it("validates against the manifest + capability catalog", () => {
    expect(validatePluginModule(ntfyPlugin)).toBeDefined();
  });
});

describe("ntfy SSRF mitigation", () => {
  it("serverUrl has x-allowed-host: true to gate SSRF via isBlockedHostname", () => {
    const schema = ntfyPlugin.manifest.userConfigSchema as {
      properties?: Record<string, Record<string, unknown>>;
    };
    expect(schema?.properties?.["serverUrl"]?.["x-allowed-host"]).toBe(true);
  });

  it("manifest does not use wildcard allowedHosts", () => {
    expect(ntfyPlugin.manifest.allowedHosts).not.toContain("*");
  });
});

describe("ntfy notificationDelivery contract", () => {
  it("deliver: POSTs to ${serverUrl}/${topic} with headers + body", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({ id: "abc123" })] });
    const result = await ntfyPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: sampleEvent,
      channelConfig,
    });

    expect(ctx.calls[0]?.url).toBe("https://ntfy.example.com/alerts");
    expect(ctx.calls[0]?.init?.method).toBe("POST");
    const headers = ctx.calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Title).toBe("System Error");
    expect(headers.Priority).toBe("5");
    expect(headers.Tags).toBe("system");
    expect(ctx.calls[0]?.init?.body).toBe("scheduler: boom");
    expect(result).toEqual({ providerMessageId: "abc123" });
  });

  it("deliver: forwards Authorization when authHeader is set", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({})] });
    await ntfyPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: sampleEvent,
      channelConfig: { ...channelConfig, authHeader: "Bearer tk_xxx" },
    });
    const headers = ctx.calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tk_xxx");
  });

  it("deliver: trims trailing slash on serverUrl and url-encodes topic", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({})] });
    await ntfyPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: sampleEvent,
      channelConfig: { serverUrl: "https://ntfy.example.com/", topic: "my topic" },
    });
    expect(ctx.calls[0]?.url).toBe("https://ntfy.example.com/my%20topic");
  });

  it("testDelivery: GETs serverUrl and reports ok on 2xx", async () => {
    const ctx = makeTestContext({ responses: [statusRes(200, "ntfy")] });
    const out = await ntfyPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(ctx.calls[0]?.url).toBe("https://ntfy.example.com");
    expect(ctx.calls[0]?.init?.method).toBe("GET");
    expect(out).toEqual({ ok: true });
  });

  it("testDelivery: surfaces 401 as ok=false with auth message", async () => {
    const ctx = makeTestContext({ responses: [statusRes(401)] });
    const out = await ntfyPlugin.capabilities.notificationDelivery!.testDelivery(ctx, {
      channelConfig,
    });
    expect(out.ok).toBe(false);
    expect(out.message).toContain("auth rejected");
  });
});

describe("ntfy notificationDelivery error semantics", () => {
  it("5xx: throws retryable plugin.upstream_error", async () => {
    const ctx = makeTestContext({ responses: [statusRes(503, "down")] });
    await expect(
      ntfyPlugin.capabilities.notificationDelivery!.deliver(ctx, {
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

  it("429 with Retry-After: throws retryable plugin.rate_limited carrying retryAfterMs", async () => {
    const ctx = makeTestContext({
      responses: [statusRes(429, "slow", { headers: { "retry-after": "90" } })],
    });
    try {
      await ntfyPlugin.capabilities.notificationDelivery!.deliver(ctx, {
        message,
        event: sampleEvent,
        channelConfig,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(isPluginError(err)).toBe(true);
      expect((err as { code: string }).code).toBe("plugin.rate_limited");
      expect((err as { retryable: boolean }).retryable).toBe(true);
      expect((err as { retryAfterMs: number }).retryAfterMs).toBe(90_000);
    }
  });

  it("401: throws non-retryable plugin.bad_credentials", async () => {
    const ctx = makeTestContext({ responses: [statusRes(401, "no")] });
    await expect(
      ntfyPlugin.capabilities.notificationDelivery!.deliver(ctx, {
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

  it("404: throws non-retryable plugin.bad_credentials", async () => {
    const ctx = makeTestContext({ responses: [statusRes(404)] });
    await expect(
      ntfyPlugin.capabilities.notificationDelivery!.deliver(ctx, {
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
