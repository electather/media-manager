// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { setupVirtualizerEnv } from "@/shared/components/virtualized/__tests__/virtualizer-test-env";
import { makeItem } from "../__fixtures__/watchlist-items.fixture";

// The card pulls the watchlist mutation graph (query client); stub it so the
// test targets the virtual-window fetch trigger, not card internals.
vi.mock("../components/watchlist-card", () => ({
  WatchlistCard: ({ item }: { item: { id: string } }) => <div data-testid="card">{item.id}</div>,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

const { fetchNextPageMock, useAllItemsMock } = vi.hoisted(() => ({
  fetchNextPageMock: vi.fn(() => Promise.resolve()),
  useAllItemsMock: vi.fn(),
}));
vi.mock("../hooks/use-all-items", () => ({ useAllItems: useAllItemsMock }));

const { AllItems } = await import("../components/sections/all-items");

let env: ReturnType<typeof setupVirtualizerEnv> | undefined;

beforeEach(() => {
  fetchNextPageMock.mockClear();
  useAllItemsMock.mockReset();
});

afterEach(() => {
  cleanup();
  env?.cleanup();
  env = undefined;
});

describe("AllItems virtual-window fetch (US-012, #519)", () => {
  it("fetches the next page when the end is within the rendered window", async () => {
    // A short list whose only row sits inside the viewport — the window
    // already reaches the end, so the proximity trigger fires.
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 1024, elementHeight: 336 });
    useAllItemsMock.mockReturnValue({
      items: [makeItem({ id: "movie:1", tmdbId: "1" }), makeItem({ id: "movie:2", tmdbId: "2" })],
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
    });
    render(<AllItems sort="recent" bucket="ready" />);
    await waitFor(() => expect(fetchNextPageMock).toHaveBeenCalled());
  });

  it("does not fetch while the end is still far below the window", async () => {
    // A long list with a short viewport: only the first rows mount, so the
    // last row stays out of the window and no fetch fires on first paint.
    env = setupVirtualizerEnv({ width: 1024, height: 400, elementWidth: 1024, elementHeight: 336 });
    const items = Array.from({ length: 500 }, (_, i) =>
      makeItem({ id: `movie:${i}`, tmdbId: String(i) }),
    );
    useAllItemsMock.mockReturnValue({
      items,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
    });
    render(<AllItems sort="recent" bucket="ready" />);
    // Let any pending effects flush, then assert the trigger stayed quiet.
    await waitFor(() =>
      expect(document.querySelectorAll("[data-index]").length).toBeGreaterThan(0),
    );
    expect(fetchNextPageMock).not.toHaveBeenCalled();
  });

  it("does not fetch when the source reports no next page", async () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 1024, elementHeight: 336 });
    useAllItemsMock.mockReturnValue({
      items: [makeItem({ id: "movie:1", tmdbId: "1" })],
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
    });
    render(<AllItems sort="recent" bucket="ready" />);
    await waitFor(() =>
      expect(document.querySelectorAll("[data-index]").length).toBeGreaterThan(0),
    );
    expect(fetchNextPageMock).not.toHaveBeenCalled();
  });
});
