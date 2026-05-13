// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { NotificationItemDto } from "../../shared/types";

// Control value for useUnreadCount mock between renders.
let mockCount: number | undefined;

vi.mock("../../bell/use-unread-count", () => ({
  useUnreadCount: () => ({ data: mockCount !== undefined ? { count: mockCount } : undefined }),
}));

vi.mock("../../inbox/use-inbox-mutations", () => ({
  useMarkRead: () => ({ mutate: vi.fn() }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

const fetchInboxPageMock = vi.fn();
vi.mock("../../shared/fetchers", () => ({
  fetchInboxPage: (...args: unknown[]) => fetchInboxPageMock(...args),
}));

const fetchInboxAfterMock = vi.fn();
vi.mock("../fetch-inbox-after", () => ({
  fetchInboxAfter: (...args: unknown[]) => fetchInboxAfterMock(...args),
}));

const renderToastMock = vi.fn();
const renderClusterToastMock = vi.fn();
vi.mock("../toast-renderer", () => ({
  renderToast: (...args: unknown[]) => renderToastMock(...args),
  renderClusterToast: (...args: unknown[]) => renderClusterToastMock(...args),
}));

// Stable broadcast stub — has() always returns false unless overridden per test.
let broadcastHasFn: (id: string) => boolean = () => false;
vi.mock("../use-toast-broadcast", () => ({
  useToastBroadcast: () => ({
    has: (id: string) => broadcastHasFn(id),
    publish: vi.fn(),
  }),
}));

import { useNotificationToaster } from "../use-notification-toaster";

function makeItem(
  id: string,
  severity: NotificationItemDto["severity"] = "warn",
): NotificationItemDto {
  return {
    id,
    title: `t-${id}`,
    body: "b",
    severity,
    category: "media",
    createdAt: Date.now(),
    readAt: null,
  } as NotificationItemDto;
}

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  mockCount = undefined;
  broadcastHasFn = () => false;
  fetchInboxPageMock.mockReset();
  fetchInboxAfterMock.mockReset();
  renderToastMock.mockReset();
  renderClusterToastMock.mockReset();
  // Default seed: one item so cursor gets set.
  fetchInboxPageMock.mockResolvedValue({ items: [makeItem("seed")] });
});

afterEach(() => cleanup());

describe("useNotificationToaster", () => {
  it("boot-suppress: fires no toasts on first observation, seeds cursor", async () => {
    mockCount = 5;

    renderHook(() => useNotificationToaster(), { wrapper: makeWrapper() });

    await waitFor(() => expect(fetchInboxPageMock).toHaveBeenCalledTimes(1));
    expect(renderToastMock).not.toHaveBeenCalled();
    expect(fetchInboxAfterMock).not.toHaveBeenCalled();
  });

  it("delta detection: count increase after boot triggers fetch and renders toasts", async () => {
    mockCount = 5;
    const items = [makeItem("a"), makeItem("b")];
    fetchInboxAfterMock.mockResolvedValue({ items });

    const { rerender } = renderHook(() => useNotificationToaster(), { wrapper: makeWrapper() });

    // Boot — seed cursor, no toasts.
    await waitFor(() => expect(fetchInboxPageMock).toHaveBeenCalledTimes(1));

    // Count increases from 5 → 7.
    mockCount = 7;
    await act(async () => {
      rerender();
    });

    await waitFor(() => expect(renderToastMock).toHaveBeenCalledTimes(2));
    expect(renderToastMock).toHaveBeenCalledWith(items[0], expect.anything());
    expect(renderToastMock).toHaveBeenCalledWith(items[1], expect.anything());
    expect(renderClusterToastMock).not.toHaveBeenCalled();
  });

  it("overflow: 6 new toastable items → 3 individual toasts + cluster with count=3", async () => {
    mockCount = 5;
    const items = Array.from({ length: 6 }, (_, i) => makeItem(`n-${i}`));
    fetchInboxAfterMock.mockResolvedValue({ items });

    const { rerender } = renderHook(() => useNotificationToaster(), { wrapper: makeWrapper() });

    await waitFor(() => expect(fetchInboxPageMock).toHaveBeenCalledTimes(1));

    mockCount = 11;
    await act(async () => {
      rerender();
    });

    await waitFor(() => expect(renderToastMock).toHaveBeenCalledTimes(3));
    expect(renderClusterToastMock).toHaveBeenCalledTimes(1);
    // Cluster receives the overflow count (6 total - 3 shown = 3).
    expect(renderClusterToastMock).toHaveBeenCalledWith(3, expect.anything());
  });

  it("dedup: items already in broadcast are not rendered", async () => {
    mockCount = 5;
    const items = [makeItem("dup"), makeItem("fresh")];
    fetchInboxAfterMock.mockResolvedValue({ items });
    // Mark "dup" as already broadcast.
    broadcastHasFn = (id) => id === "dup";

    const { rerender } = renderHook(() => useNotificationToaster(), { wrapper: makeWrapper() });

    await waitFor(() => expect(fetchInboxPageMock).toHaveBeenCalledTimes(1));

    mockCount = 7;
    await act(async () => {
      rerender();
    });

    await waitFor(() => expect(renderToastMock).toHaveBeenCalledTimes(1));
    expect(renderToastMock).toHaveBeenCalledWith(items[1], expect.anything());
    expect(renderToastMock).not.toHaveBeenCalledWith(items[0], expect.anything());
  });
});
