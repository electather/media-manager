// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const fetchersMock = vi.hoisted(() => ({
  fetchUnreadCount: vi.fn(),
  fetchInboxPage: vi.fn(),
  fetchMarkRead: vi.fn(),
  fetchMarkAllRead: vi.fn(),
  fetchDismiss: vi.fn(),
  fetchMarkUnread: vi.fn(),
  fetchDeleteInboxAll: vi.fn(),
}));

vi.mock("../../shared/fetchers", () => fetchersMock);

import { NotificationBell, bellAriaLabel } from "../notification-bell";

function renderWithClient(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  fetchersMock.fetchUnreadCount.mockResolvedValue({ count: 0 });
  fetchersMock.fetchInboxPage.mockResolvedValue({ items: [], unreadCount: 0 });
});

describe("bellAriaLabel", () => {
  it("returns plain title with no unread", () => {
    expect(bellAriaLabel(0)).toBe("Notifications");
  });
  it("includes count when unread", () => {
    expect(bellAriaLabel(3)).toBe("Notifications, 3 unread");
  });
});

describe("NotificationBell", () => {
  it("renders chrome immediately and shows unread aria when count > 0", async () => {
    fetchersMock.fetchUnreadCount.mockResolvedValue({ count: 5 });
    renderWithClient(<NotificationBell />);
    expect(screen.getByRole("button", { name: /notifications/i })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /5 unread/i })).toBeTruthy();
    });
  });

  it("polls unread count via fetchUnreadCount", async () => {
    renderWithClient(<NotificationBell />);
    await waitFor(() => {
      expect(fetchersMock.fetchUnreadCount).toHaveBeenCalled();
    });
  });
});
