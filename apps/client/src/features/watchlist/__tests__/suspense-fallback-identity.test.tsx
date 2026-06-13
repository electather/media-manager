// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import type { WatchlistBucket } from "@nama/shared/watchlist";

afterEach(() => cleanup());

vi.mock("@tanstack/react-router", () => ({
  useSearch: () => ({}),
  useParams: () => ({ moodId: "epic" }),
  useNavigate: () => vi.fn(),
}));

// Force the suspending child to actually suspend so we can assert the
// rendered fallback element identity (V.WL10).
vi.mock("../hooks/use-all-items", () => ({
  useAllItems: () => {
    throw new Promise(() => {});
  },
}));
vi.mock("../hooks/use-mood-cluster", () => ({
  useMoodCluster: () => {
    throw new Promise(() => {});
  },
}));

const { WatchlistFlatPage } = await import("../components/watchlist-flat-page");
const { WatchlistMoodPage } = await import("../components/watchlist-mood-page");

const FLAT_BUCKETS: WatchlistBucket[] = [
  "ready",
  "in-progress",
  "awaiting",
  "unavailable",
  "upcoming",
];

describe("Suspense fallback identity (V.WL10)", () => {
  it.each(FLAT_BUCKETS)("WatchlistFlatPage(%s) suspends with WatchlistGridSkeleton", (bucket) => {
    render(<WatchlistFlatPage bucket={bucket} />);
    // Identity assertion — fallback uses the shared grid-skeleton, not a
    // generic <Skeleton h-[Npx]/> placeholder.
    expect(screen.getByTestId("grid-skeleton")).toBeDefined();
  });

  it("WatchlistMoodPage suspends with WatchlistGridSkeleton", () => {
    render(<WatchlistMoodPage />);
    expect(screen.getByTestId("grid-skeleton")).toBeDefined();
  });
});
