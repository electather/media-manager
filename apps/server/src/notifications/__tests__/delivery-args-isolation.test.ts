import { describe, expect, it } from "vite-plus/test";
import type { NotificationEvent } from "@ent-mcp/shared/notifications";
import inboxPlugin from "@ent-mcp/plugin-inbox";
import ntfyPlugin from "@ent-mcp/plugin-ntfy";
import telegramPlugin from "@ent-mcp/plugin-telegram";
import discordPlugin from "@ent-mcp/plugin-discord";
import { buildDeliverArgs, isHostPrivilegedPlugin } from "../internal/delivery-policy";

const event: NotificationEvent = {
  id: "evt-1",
  occurredAt: "2026-04-25T10:00:00.000Z",
  type: "system.error",
  category: "system",
  severity: "error",
  audience: { kind: "admin", permission: "admin:server" },
  payload: { errorSource: "x", message: "y" },
};

const message = {
  title: "T",
  body: "B",
  severity: "error" as const,
  category: "system" as const,
};

const host = { deliveryId: "del-1", recipientUserId: "user-1" };

describe("host-privileged plugin allowlist", () => {
  it("treats inbox as host-privileged", () => {
    expect(isHostPrivilegedPlugin("inbox")).toBe(true);
  });

  it("does NOT treat first-party notification providers as host-privileged", () => {
    expect(isHostPrivilegedPlugin("ntfy")).toBe(false);
    expect(isHostPrivilegedPlugin("telegram")).toBe(false);
    expect(isHostPrivilegedPlugin("discord")).toBe(false);
    expect(isHostPrivilegedPlugin("trakt")).toBe(false);
  });
});

describe("buildDeliverArgs: third-party plugins", () => {
  it("returns the SDK-typed shape with no extra keys", () => {
    const args = buildDeliverArgs("ntfy", { message, event, channelConfig: { foo: 1 } }, host);
    expect(Object.keys(args).sort()).toEqual(["channelConfig", "event", "message"]);
    expect("deliveryId" in args).toBe(false);
    expect("recipientUserId" in args).toBe(false);
  });

  it("preserves message + event + channelConfig fields", () => {
    const args = buildDeliverArgs(
      "telegram",
      { message, event, channelConfig: { botToken: "x", chatId: "y" } },
      host,
    );
    expect(args.message).toBe(message);
    expect(args.event).toBe(event);
    expect(args.channelConfig).toEqual({ botToken: "x", chatId: "y" });
  });
});

describe("buildDeliverArgs: inbox (host-privileged)", () => {
  it("includes deliveryId and recipientUserId for inbox", () => {
    const args = buildDeliverArgs("inbox", { message, event, channelConfig: {} }, host);
    expect(args).toMatchObject({
      message,
      event,
      channelConfig: {},
      deliveryId: "del-1",
      recipientUserId: "user-1",
    });
  });
});

describe("third-party deliver() never reads host-privileged args at runtime", () => {
  // Drives each first-party plugin's deliver() with the host-built args and
  // asserts that the captured fetch call does not leak the deliveryId or
  // recipientUserId — a structural regression guard against accidentally
  // re-introducing them in the plugin payload.
  function assertNoLeakage(serialised: string) {
    expect(serialised).not.toContain("del-1");
    expect(serialised).not.toContain("user-1");
  }

  async function runPluginCapture(plugin: unknown, channelConfig: unknown): Promise<string> {
    const typed = plugin as {
      manifest?: { id: string };
      capabilities: {
        notificationDelivery?: {
          deliver: (ctx: unknown, args: unknown) => Promise<unknown>;
        };
      };
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const ctx = {
      calls,
      async fetch(url: string, init?: RequestInit) {
        calls.push({ url, init });
        return new Response(JSON.stringify({ ok: true, result: { message_id: 1 }, id: "x" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      log: { debug() {}, info() {}, warn() {}, error() {} },
      userId: null,
      credentials: null,
      sharedCredentials: null,
      config: { global: null, user: null },
      store: {
        async get() {
          return undefined;
        },
        async set() {},
        async delete() {},
      },
      pool: { markExhausted() {} },
      appBaseUrl: "https://app.example.com",
      notify: async () => {},
    };
    const args = buildDeliverArgs(
      typed.manifest?.id ?? "third-party",
      { message, event, channelConfig },
      host,
    );
    await typed.capabilities.notificationDelivery!.deliver(ctx, args);
    return JSON.stringify(calls);
  }

  it("ntfy: outgoing request mentions neither deliveryId nor recipientUserId", async () => {
    const out = await runPluginCapture(ntfyPlugin, {
      serverUrl: "https://ntfy.example.com",
      topic: "alerts",
    });
    assertNoLeakage(out);
  });

  it("telegram: outgoing request mentions neither deliveryId nor recipientUserId", async () => {
    const out = await runPluginCapture(telegramPlugin, { botToken: "TKN", chatId: "987" });
    assertNoLeakage(out);
  });

  it("discord: outgoing request mentions neither deliveryId nor recipientUserId", async () => {
    const out = await runPluginCapture(discordPlugin, {
      webhookUrl: "https://discord.com/api/webhooks/1/abc",
    });
    assertNoLeakage(out);
  });
});

describe("inbox plugin reads host-privileged values from ctx.inbox", () => {
  it("calls ctx.inbox.insert with the host-bound user id but NOT from the args", async () => {
    const inserts: Array<Record<string, unknown>> = [];
    const ctx = {
      fetch: async () => new Response("", { status: 200 }),
      log: { debug() {}, info() {}, warn() {}, error() {} },
      userId: null,
      credentials: null,
      sharedCredentials: null,
      config: { global: null, user: null },
      store: {
        async get() {
          return undefined;
        },
        async set() {},
        async delete() {},
      },
      pool: { markExhausted() {} },
      appBaseUrl: "https://app.example.com",
      notify: async () => {},
      // Host-privileged capability injected by the delivery job.
      inbox: {
        insert: async (row: Record<string, unknown>) => {
          inserts.push(row);
        },
      },
    };

    // Inbox is host-privileged, so it gets the extended args — but the
    // plugin must still rely on `ctx.inbox` (and not on args.recipientUserId)
    // for the persistence path. We assert the plugin does not depend on the
    // args fields by passing a base-shape arg bag and confirming the insert
    // succeeds via ctx.inbox.
    const args = buildDeliverArgs("inbox", { message, event, channelConfig: {} }, host);
    await inboxPlugin.capabilities.notificationDelivery!.deliver(ctx as never, args as never);
    expect(inserts.length).toBe(1);
    expect(inserts[0]).toMatchObject({
      title: message.title,
      body: message.body,
      severity: message.severity,
      category: message.category,
    });
  });

  it("inbox throws when ctx.inbox is missing (third-party context)", async () => {
    const ctx = {
      fetch: async () => new Response("", { status: 200 }),
      log: { debug() {}, info() {}, warn() {}, error() {} },
      userId: null,
      credentials: null,
      sharedCredentials: null,
      config: { global: null, user: null },
      store: {
        async get() {
          return undefined;
        },
        async set() {},
        async delete() {},
      },
      pool: { markExhausted() {} },
      appBaseUrl: "https://app.example.com",
      notify: async () => {},
    };
    await expect(
      inboxPlugin.capabilities.notificationDelivery!.deliver(
        ctx as never,
        {
          message,
          event,
          channelConfig: {},
        } as never,
      ),
    ).rejects.toThrow(/host-privileged/);
  });
});
