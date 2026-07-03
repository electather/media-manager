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
  useParams: () => ({ moodId: "cozy" }),
}));

const { fetchNextPageMock, useMoodClusterMock } = vi.hoisted(() => ({
  fetchNextPageMock: vi.fn(() => Promise.resolve()),
  useMoodClusterMock: vi.fn(),
}));
vi.mock("../hooks/use-mood-cluster", () => ({ useMoodCluster: useMoodClusterMock }));

const { WatchlistMoodPage } = await import("../components/watchlist-mood-page");

let env: ReturnType<typeof setupVirtualizerEnv> | undefined;

beforeEach(() => {
  fetchNextPageMock.mockClear();
  useMoodClusterMock.mockReset();
});

afterEach(() => {
  cleanup();
  env?.cleanup();
  env = undefined;
});

describe("WatchlistMoodPage virtual-window fetch (#519)", () => {
  it("fetches the next page via onEndReached when the end is within the window", async () => {
    // A short list whose only rows sit inside the viewport — the window
    // already reaches the end, so the proximity trigger fires. The mood grid
    // relies on infinite scroll, not a load-more button, for pagination.
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 1024, elementHeight: 336 });
    useMoodClusterMock.mockReturnValue({
      items: [makeItem({ id: "movie:1", tmdbId: "1" }), makeItem({ id: "movie:2", tmdbId: "2" })],
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
      error: null,
    });
    render(<WatchlistMoodPage />);
    await waitFor(() => expect(fetchNextPageMock).toHaveBeenCalled());
  });

  it("does not fetch while the end is still far below the window", async () => {
    // A long list with a short viewport: only the first rows mount, so the
    // last row stays out of the window and no fetch fires on first paint.
    env = setupVirtualizerEnv({ width: 1024, height: 400, elementWidth: 1024, elementHeight: 336 });
    const items = Array.from({ length: 500 }, (_, i) =>
      makeItem({ id: `movie:${i}`, tmdbId: String(i) }),
    );
    useMoodClusterMock.mockReturnValue({
      items,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
      error: null,
    });
    render(<WatchlistMoodPage />);
    // Let any pending effects flush, then assert the trigger stayed quiet.
    await waitFor(() =>
      expect(document.querySelectorAll("[data-index]").length).toBeGreaterThan(0),
    );
    expect(fetchNextPageMock).not.toHaveBeenCalled();
  });

  it("does not fetch when the source reports no next page", async () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 1024, elementHeight: 336 });
    useMoodClusterMock.mockReturnValue({
      items: [makeItem({ id: "movie:1", tmdbId: "1" })],
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
      error: null,
    });
    render(<WatchlistMoodPage />);
    await waitFor(() =>
      expect(document.querySelectorAll("[data-index]").length).toBeGreaterThan(0),
    );
    expect(fetchNextPageMock).not.toHaveBeenCalled();
  });

  it("renders no load-more button — infinite scroll is the only pagination affordance", () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 1024, elementHeight: 336 });
    useMoodClusterMock.mockReturnValue({
      items: [makeItem({ id: "movie:1", tmdbId: "1" })],
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
      error: null,
    });
    const { container } = render(<WatchlistMoodPage />);
    expect(container.querySelector("button")).toBeNull();
  });
});
