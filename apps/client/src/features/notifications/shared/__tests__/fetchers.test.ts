// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const apiMock = vi.hoisted(() => ({
  inboxGet: vi.fn(),
  unreadCountGet: vi.fn(),
  channelTestPost: vi.fn(),
}));

vi.mock("@/shared/lib/api", () => ({
  api: {
    notifications: {
      inbox: {
        $get: (args: unknown) => apiMock.inboxGet(args),
        "unread-count": { $get: () => apiMock.unreadCountGet() },
      },
      channels: {
        ":id": {
          test: { $post: (args: unknown) => apiMock.channelTestPost(args) },
        },
      },
    },
  },
}));

import { fetchInboxPage, fetchTestChannel, fetchUnreadCount } from "../fetchers";
import { NotificationsApiError } from "../types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  apiMock.inboxGet.mockReset();
  apiMock.unreadCountGet.mockReset();
  apiMock.channelTestPost.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("fetchers error normalisation", () => {
  it("wraps 4xx responses in NotificationsApiError with the parsed body", async () => {
    apiMock.inboxGet.mockResolvedValue(
      jsonResponse({ code: "notifications.bad_filter", message: "bad filter" }, 400),
    );
    await expect(fetchInboxPage({}, null)).rejects.toMatchObject({
      name: "NotificationsApiError",
      status: 400,
      code: "notifications.bad_filter",
    });
  });

  it("wraps 5xx responses with a fallback message when body has none", async () => {
    apiMock.inboxGet.mockResolvedValue(jsonResponse({}, 503));
    const err = await fetchInboxPage({}, null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotificationsApiError);
    expect((err as NotificationsApiError).status).toBe(503);
    expect((err as NotificationsApiError).message).toContain("503");
  });

  it("returns parsed JSON on 2xx", async () => {
    apiMock.unreadCountGet.mockResolvedValue(jsonResponse({ count: 7 }));
    await expect(fetchUnreadCount()).resolves.toEqual({ count: 7 });
  });
});

describe("fetchTestChannel — body.ok routing", () => {
  it("resolves when the server reports ok: true", async () => {
    apiMock.channelTestPost.mockResolvedValue(jsonResponse({ ok: true }));
    await expect(fetchTestChannel("conn_1")).resolves.toEqual({ ok: true });
  });

  it("throws when the server reports ok: false even on HTTP 200", async () => {
    // Regression: the test endpoint always returns HTTP 200 with the plugin's
    // `{ ok, message }` payload. The previous implementation only inspected
    // `res.ok`, so the UI fired the success toast for failed probes.
    apiMock.channelTestPost.mockResolvedValue(
      jsonResponse({ ok: false, message: "telegram bot token rejected" }),
    );
    const err = await fetchTestChannel("conn_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotificationsApiError);
    expect((err as NotificationsApiError).code).toBe("notifications.test_failed");
    expect((err as NotificationsApiError).body?.message).toBe("telegram bot token rejected");
  });

  it("supplies a fallback message when ok: false has no description", async () => {
    apiMock.channelTestPost.mockResolvedValue(jsonResponse({ ok: false }));
    const err = await fetchTestChannel("conn_1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotificationsApiError);
    expect((err as NotificationsApiError).body?.message).toBe("test failed");
  });
});
