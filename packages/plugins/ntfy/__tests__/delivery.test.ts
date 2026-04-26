import { describe, expect, it } from "vite-plus/test";
import { jsonRes, makeTestContext } from "@ent-mcp/plugin-sdk/testing";
import type { NotificationEvent, NotificationMessage } from "@ent-mcp/shared/notifications";
import ntfyPlugin from "../src/plugin";

const channelConfig = {
  serverUrl: "https://ntfy.example.com",
  topic: "alerts",
};

function buildEvent<T extends NotificationEvent["type"]>(
  type: T,
  payload: Extract<NotificationEvent, { type: T }>["payload"],
): NotificationEvent {
  const base = {
    id: `evt-${type}`,
    occurredAt: "2026-04-25T10:00:00.000Z",
  };
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

describe("ntfy: content-kind handling", () => {
  it("attaches the image url via the Attach header when message.image is set", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({})] });
    const message: NotificationMessage = {
      title: "Available",
      body: "Fight Club is now available",
      severity: "info",
      category: "media",
      image: { url: "https://image.tmdb.org/t/p/w500/poster.jpg", alt: "Fight Club" },
    };
    await ntfyPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: buildEvent("media.request.available", {
        requestId: "1",
        mediaId: "550",
        title: "Fight Club",
      }),
      channelConfig,
    });
    const headers = ctx.calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Attach).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
  });

  it("renders multiple actions into the Actions header joined with semicolons", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({})] });
    const message: NotificationMessage = {
      title: "Choose",
      body: "Pick one",
      severity: "info",
      category: "media",
      actions: [
        { label: "View", url: "https://example.com/a" },
        { label: "Dismiss", url: "https://example.com/b" },
      ],
    };
    await ntfyPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: buildEvent("system.error", { errorSource: "x", message: "y" }),
      channelConfig,
    });
    const headers = ctx.calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Actions).toBe(
      "view, View, https://example.com/a; view, Dismiss, https://example.com/b",
    );
  });

  it("forwards actionUrl as the Click header", async () => {
    const ctx = makeTestContext({ responses: [jsonRes({})] });
    const message: NotificationMessage = {
      title: "Open",
      body: "Click to view",
      severity: "info",
      category: "media",
      actionUrl: "https://example.com/open",
    };
    await ntfyPlugin.capabilities.notificationDelivery!.deliver(ctx, {
      message,
      event: buildEvent("media.request.available", {
        requestId: "1",
        mediaId: "550",
        title: "Fight Club",
      }),
      channelConfig,
    });
    const headers = ctx.calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Click).toBe("https://example.com/open");
  });
});

describe("ntfy: per-event-type payload snapshots", () => {
  function captureRequest(message: NotificationMessage, event: NotificationEvent) {
    const ctx = makeTestContext({ responses: [jsonRes({})] });
    return ntfyPlugin.capabilities
      .notificationDelivery!.deliver(ctx, { message, event, channelConfig })
      .then(() => ({
        url: ctx.calls[0]?.url,
        method: ctx.calls[0]?.init?.method,
        headers: ctx.calls[0]?.init?.headers,
        body: ctx.calls[0]?.init?.body,
      }));
  }

  it("job.run.failed", async () => {
    const out = await captureRequest(
      {
        title: "Job Failed",
        body: "scheduler:job-1 failed",
        severity: "error",
        category: "system",
      },
      buildEvent("job.run.failed", { jobId: "j1", runId: "r1", error: "boom" }),
    );
    expect(out).toMatchSnapshot();
  });

  it("connection.auth.expired", async () => {
    const out = await captureRequest(
      {
        title: "Auth Expired",
        body: "Authentication for trakt expired. Please re-authenticate.",
        severity: "warn",
        category: "auth",
      },
      buildEvent("connection.auth.expired", { connectionId: "c1", pluginId: "trakt" }),
    );
    expect(out).toMatchSnapshot();
  });

  it("connection.sync.succeeded", async () => {
    const out = await captureRequest(
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
    );
    expect(out).toMatchSnapshot();
  });

  it("media.request.available", async () => {
    const out = await captureRequest(
      {
        title: "Fight Club Available",
        body: "Your requested media is now available.",
        severity: "info",
        category: "media",
        image: { url: "https://image.tmdb.org/t/p/w500/p.jpg", alt: "Fight Club" },
      },
      buildEvent("media.request.available", {
        requestId: "1",
        mediaId: "550",
        title: "Fight Club",
        posterUrl: "https://image.tmdb.org/t/p/w500/p.jpg",
      }),
    );
    expect(out).toMatchSnapshot();
  });

  it("media.request.denied", async () => {
    const out = await captureRequest(
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
    );
    expect(out).toMatchSnapshot();
  });

  it("system.error", async () => {
    const out = await captureRequest(
      {
        title: "System Error",
        body: "scheduler: boom",
        severity: "error",
        category: "system",
      },
      buildEvent("system.error", { errorSource: "scheduler", message: "boom" }),
    );
    expect(out).toMatchSnapshot();
  });
});
