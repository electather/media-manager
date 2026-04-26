import { describe, expect, it } from "vite-plus/test";
import { jsonRes, makeTestContext } from "@ent-mcp/plugin-sdk/testing";
import type { NotificationEvent, NotificationMessage } from "@ent-mcp/shared/notifications";
import discordPlugin from "../src/plugin";

const channelConfig = { webhookUrl: "https://discord.com/api/webhooks/123/abc" };

function buildEvent<T extends NotificationEvent["type"]>(
  type: T,
  payload: Extract<NotificationEvent, { type: T }>["payload"],
): NotificationEvent {
  const base = { id: `evt-${type}`, occurredAt: "2026-04-25T10:00:00.000Z" };
  switch (type) {
    case "media.request.available":
      return {
        ...base,
        type,
        category: "media",
        severity: "info",
        audience: { kind: "user", userId: "u1" },
        payload,
      } as NotificationEvent;
    case "media.request.denied":
      return {
        ...base,
        type,
        category: "media",
        severity: "warn",
        audience: { kind: "user", userId: "u1" },
        payload,
      } as NotificationEvent;
    case "connection.auth.expired":
      return {
        ...base,
        type,
        category: "auth",
        severity: "warn",
        audience: { kind: "user", userId: "u1" },
        payload,
      } as NotificationEvent;
    case "connection.sync.succeeded":
      return {
        ...base,
        type,
        category: "sync",
        severity: "info",
        audience: { kind: "user", userId: "u1" },
        payload,
      } as NotificationEvent;
    case "job.run.failed":
      return {
        ...base,
        type,
        category: "system",
        severity: "error",
        audience: { kind: "admin", permission: "admin:server" },
        payload,
      } as NotificationEvent;
    case "system.error":
      return {
        ...base,
        type,
        category: "system",
        severity: "error",
        audience: { kind: "admin", permission: "admin:server" },
        payload,
      } as NotificationEvent;
  }
  throw new Error(`unknown event type ${String(type)}`);
}

function readBody(call: { init?: RequestInit }) {
  const body = call.init?.body;
  return JSON.parse(typeof body === "string" ? body : "{}") as Record<string, unknown>;
}

describe("discord: content-kind handling", () => {
  it("includes the image url on the embed when set", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({})] });
    const message: NotificationMessage = {
      title: "Available",
      body: "ready",
      severity: "info",
      category: "media",
      image: { url: "https://image.tmdb.org/p.jpg", alt: "alt" },
    };
    await discordPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: buildEvent("media.request.available", {
        requestId: "1",
        mediaId: "550",
        title: "x",
        posterUrl: "https://image.tmdb.org/p.jpg",
      }),
      channelConfig,
    });
    const body = readBody(ctx.calls[0]!);
    const embed = (body.embeds as Array<Record<string, unknown>>)[0]!;
    expect(embed.image).toEqual({ url: "https://image.tmdb.org/p.jpg" });
  });

  it("renders actions as link-button components", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({})] });
    const message: NotificationMessage = {
      title: "T",
      body: "B",
      severity: "info",
      category: "media",
      actions: [
        { label: "View", url: "https://example.com/a" },
        { label: "Dismiss", url: "https://example.com/b" },
      ],
    };
    await discordPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: buildEvent("system.error", { errorSource: "x", message: "y" }),
      channelConfig,
    });
    const body = readBody(ctx.calls[0]!);
    expect(body.components).toEqual([
      {
        type: 1,
        components: [
          { type: 2, style: 5, label: "View", url: "https://example.com/a" },
          { type: 2, style: 5, label: "Dismiss", url: "https://example.com/b" },
        ],
      },
    ]);
  });

  it("uses bodyMarkdown for the embed description when set", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({})] });
    const md = "**hello** _world_";
    const message: NotificationMessage = {
      title: "T",
      body: "fallback",
      bodyMarkdown: md,
      severity: "info",
      category: "media",
    };
    await discordPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: buildEvent("system.error", { errorSource: "x", message: "y" }),
      channelConfig,
    });
    const body = readBody(ctx.calls[0]!);
    expect((body.embeds as Array<Record<string, unknown>>)[0]?.description).toBe(md);
  });
});

describe("discord: per-event-type payload snapshots", () => {
  function captureRequest(message: NotificationMessage, event: NotificationEvent) {
    const ctx = makeTestContext({ responses: [jsonRes({})] });
    return discordPlugin.capabilities
      .notificationDelivery!.deliver(ctx, { message, event, channelConfig })
      .then(() => ({
        url: ctx.calls[0]?.url,
        method: ctx.calls[0]?.init?.method,
        body: ctx.calls[0]?.init?.body,
      }));
  }

  it("job.run.failed", async () => {
    expect(
      await captureRequest(
        {
          title: "Job Failed",
          body: "scheduler:job-1 failed",
          severity: "error",
          category: "system",
        },
        buildEvent("job.run.failed", { jobId: "j1", runId: "r1", error: "boom" }),
      ),
    ).toMatchSnapshot();
  });

  it("connection.auth.expired", async () => {
    expect(
      await captureRequest(
        {
          title: "Auth Expired",
          body: "Authentication for trakt expired. Please re-authenticate.",
          severity: "warn",
          category: "auth",
        },
        buildEvent("connection.auth.expired", { connectionId: "c1", pluginId: "trakt" }),
      ),
    ).toMatchSnapshot();
  });

  it("connection.sync.succeeded", async () => {
    expect(
      await captureRequest(
        {
          title: "Sync Complete",
          body: "Sync completed successfully with 42 items.",
          severity: "info",
          category: "sync",
        },
        buildEvent("connection.sync.succeeded", {
          connectionId: "c1",
          pluginId: "trakt",
          itemCount: 42,
        }),
      ),
    ).toMatchSnapshot();
  });

  it("media.request.available", async () => {
    expect(
      await captureRequest(
        {
          title: "Fight Club Available",
          body: "Your requested media is now available.",
          severity: "info",
          category: "media",
          image: { url: "https://image.tmdb.org/p.jpg", alt: "Fight Club" },
        },
        buildEvent("media.request.available", {
          requestId: "1",
          mediaId: "550",
          title: "Fight Club",
          posterUrl: "https://image.tmdb.org/p.jpg",
        }),
      ),
    ).toMatchSnapshot();
  });

  it("media.request.denied", async () => {
    expect(
      await captureRequest(
        {
          title: "Request Denied",
          body: "Your request was denied: out of policy.",
          severity: "warn",
          category: "media",
        },
        buildEvent("media.request.denied", {
          requestId: "1",
          mediaId: "550",
          title: "Request",
          reason: "out of policy",
        }),
      ),
    ).toMatchSnapshot();
  });

  it("system.error", async () => {
    expect(
      await captureRequest(
        {
          title: "System Error",
          body: "scheduler: boom",
          severity: "error",
          category: "system",
        },
        buildEvent("system.error", { errorSource: "scheduler", message: "boom" }),
      ),
    ).toMatchSnapshot();
  });
});
