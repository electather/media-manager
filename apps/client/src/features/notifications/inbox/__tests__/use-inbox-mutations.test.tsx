// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fetchersMock = vi.hoisted(() => ({
  fetchMarkRead: vi.fn(),
  fetchMarkUnread: vi.fn(),
  fetchDismiss: vi.fn(),
  fetchMarkAllRead: vi.fn(),
  fetchDeleteInboxAll: vi.fn(),
}));
vi.mock("../../shared/fetchers", () => fetchersMock);

const toastMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { useDeleteInboxAll, useDismiss, useMarkRead } from "../use-inbox-mutations";
import { notificationsKeys } from "../../shared/query-keys";
import type { NotificationItemDto } from "../../shared/types";

function makeItem(id: string, readAt: number | null = null): NotificationItemDto {
  return {
    id,
    title: `t-${id}`,
    body: "b",
    severity: "info",
    category: "media",
    audienceKind: "user",
    createdAt: 1,
    readAt,
  } as NotificationItemDto;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function withClient(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  for (const fn of Object.values(fetchersMock)) fn.mockReset();
  for (const fn of Object.values(toastMock)) fn.mockReset();
});

afterEach(() => cleanup());

describe("useMarkRead", () => {
  it("optimistically sets readAt across both inbox and popover cache shapes", async () => {
    const qc = makeClient();
    const popoverData = { items: [makeItem("a"), makeItem("b")], unreadCount: 2 };
    const infiniteData = {
      pages: [{ items: [makeItem("a"), makeItem("c")], unreadCount: 2, nextCursor: undefined }],
      pageParams: [null],
    };
    qc.setQueryData(notificationsKeys.popoverInbox({}), popoverData);
    qc.setQueryData(notificationsKeys.inbox({}), infiniteData);
    fetchersMock.fetchMarkRead.mockResolvedValue({});

    const { result } = renderHook(() => useMarkRead(), { wrapper: withClient(qc) });
    await act(async () => {
      result.current.mutate(["a"]);
    });

    const popoverAfter = qc.getQueryData<typeof popoverData>(notificationsKeys.popoverInbox({}));
    const infiniteAfter = qc.getQueryData<typeof infiniteData>(notificationsKeys.inbox({}));
    expect(popoverAfter?.items.find((i) => i.id === "a")?.readAt).not.toBeNull();
    expect(popoverAfter?.items.find((i) => i.id === "b")?.readAt).toBeNull();
    expect(infiniteAfter?.pages[0]?.items.find((i) => i.id === "a")?.readAt).not.toBeNull();
    expect(infiniteAfter?.pages[0]?.items.find((i) => i.id === "c")?.readAt).toBeNull();
  });

  it("restores cache when the request fails", async () => {
    const qc = makeClient();
    const seed = { items: [makeItem("x")], unreadCount: 1 };
    qc.setQueryData(notificationsKeys.popoverInbox({}), seed);
    fetchersMock.fetchMarkRead.mockRejectedValue(new Error("nope"));

    const { result } = renderHook(() => useMarkRead(), { wrapper: withClient(qc) });
    await act(async () => {
      try {
        await result.current.mutateAsync(["x"]);
      } catch {
        // intentional — verifying rollback path
      }
    });

    const after = qc.getQueryData<typeof seed>(notificationsKeys.popoverInbox({}));
    expect(after?.items[0]?.readAt).toBeNull();
  });
});

describe("useDismiss", () => {
  it("removes ids optimistically", async () => {
    const qc = makeClient();
    qc.setQueryData(notificationsKeys.popoverInbox({}), {
      items: [makeItem("a"), makeItem("b")],
      unreadCount: 0,
    });
    fetchersMock.fetchDismiss.mockResolvedValue({});

    const { result } = renderHook(() => useDismiss(), { wrapper: withClient(qc) });
    await act(async () => {
      result.current.mutate(["a"]);
    });

    const after = qc.getQueryData<{ items: NotificationItemDto[] }>(
      notificationsKeys.popoverInbox({}),
    );
    expect(after?.items.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("useDeleteInboxAll", () => {
  it("toasts on error so bulk failures are not silent", async () => {
    const qc = makeClient();
    fetchersMock.fetchDeleteInboxAll.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useDeleteInboxAll(), { wrapper: withClient(qc) });
    await act(async () => {
      try {
        await result.current.mutateAsync({});
      } catch {
        // intentional — verifying toast path
      }
    });
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });
});
