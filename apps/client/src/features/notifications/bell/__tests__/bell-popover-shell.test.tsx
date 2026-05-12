// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, type ReactNode } from "react";

// happy-dom lacks Element.getAnimations; Base UI ScrollArea Viewport polls it
// from a setTimeout that fires after assertions complete.
if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  Element.prototype.getAnimations = () => [];
}

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
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: ReactNode }) => (
    <a {...(props as object)}>{children}</a>
  ),
}));

import { BellPopoverShell } from "../bell-popover-shell";

function renderWithClient(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <Suspense fallback={null}>{node}</Suspense>
    </QueryClientProvider>,
  );
}

const SAMPLE_ITEMS = [
  {
    id: "m1",
    title: "Media one",
    body: "",
    severity: "info",
    category: "media",
    actionUrl: null,
    image: null,
    createdAt: Date.now(),
    readAt: null,
  },
  {
    id: "m2",
    title: "Media two",
    body: "",
    severity: "info",
    category: "media",
    actionUrl: null,
    image: null,
    createdAt: Date.now(),
    readAt: null,
  },
  {
    id: "a1",
    title: "Auth one",
    body: "",
    severity: "warn",
    category: "auth",
    actionUrl: null,
    image: null,
    createdAt: Date.now(),
    readAt: null,
  },
  {
    id: "s1",
    title: "Sync one",
    body: "",
    severity: "info",
    category: "sync",
    actionUrl: null,
    image: null,
    createdAt: Date.now(),
    readAt: Date.now(),
  },
];

beforeEach(() => {
  fetchersMock.fetchInboxPage.mockResolvedValue({ items: SAMPLE_ITEMS, unreadCount: 3 });
  fetchersMock.fetchUnreadCount.mockResolvedValue({ count: 3 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BellPopoverShell category counts", () => {
  it("category chip counts stay constant when active filter changes", async () => {
    const user = userEvent.setup();
    renderWithClient(<BellPopoverShell density="comfortable" intensity="subtle" unreadCount={3} />);

    await waitFor(() => {
      expect(fetchersMock.fetchInboxPage).toHaveBeenCalled();
    });

    const allChip = await screen.findByRole("radio", { name: /^all/i });
    const mediaChip = screen.getByRole("radio", { name: /^media/i });
    const authChip = screen.getByRole("radio", { name: /^auth/i });
    const syncChip = screen.getByRole("radio", { name: /^sync/i });

    expect(allChip.textContent).toContain("4");
    expect(mediaChip.textContent).toContain("2");
    expect(authChip.textContent).toContain("1");
    expect(syncChip.textContent).toContain("1");

    await user.click(authChip);

    // Filter switched to auth; counts on the *other* chips must not collapse.
    expect(allChip.textContent).toContain("4");
    expect(mediaChip.textContent).toContain("2");
    expect(authChip.textContent).toContain("1");
    expect(syncChip.textContent).toContain("1");
  });

  it("fetches inbox without server-side category filter", async () => {
    renderWithClient(<BellPopoverShell density="comfortable" intensity="subtle" unreadCount={3} />);
    await waitFor(() => {
      expect(fetchersMock.fetchInboxPage).toHaveBeenCalled();
    });
    const firstArg = fetchersMock.fetchInboxPage.mock.calls[0]![0];
    expect(firstArg).toEqual({});
  });
});
