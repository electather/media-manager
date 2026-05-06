// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const apiMock = vi.hoisted(() => ({
  inboxGet: vi.fn(),
  unreadCountGet: vi.fn(),
}));

vi.mock("@/shared/lib/api", () => ({
  api: {
    notifications: {
      inbox: {
        $get: (args: unknown) => apiMock.inboxGet(args),
        "unread-count": { $get: () => apiMock.unreadCountGet() },
      },
    },
  },
}));

import { fetchInboxPage, fetchUnreadCount } from "../fetchers";
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
