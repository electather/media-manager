// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import type { WatchlistBucket } from "@nama/shared/watchlist";

afterEach(() => cleanup());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../hooks/use-all-items", () => ({
  useAllItems: () => ({
    items: [],
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => Promise.resolve(),
  }),
}));

const { AllItems } = await import("../components/sections/all-items");

interface EmptyCase {
  bucket: WatchlistBucket;
  pattern: RegExp;
}

const CASES: EmptyCase[] = [
  { bucket: "ready", pattern: /nothing ready/i },
  { bucket: "in-progress", pattern: /no active sessions/i },
  { bucket: "awaiting", pattern: /no items awaiting/i },
  { bucket: "unavailable", pattern: /nothing to acquire/i },
  { bucket: "upcoming", pattern: /nothing upcoming/i },
];

describe("AllItems empty state (V.WL11)", () => {
  it.each(CASES)(
    "renders EmptyState with bucket-specific title for $bucket",
    ({ bucket, pattern }) => {
      render(<AllItems sort="recent" bucket={bucket} />);
      // Bucket-specific title visible — proves we composed `<EmptyState>` with
      // the right per-bucket paraglide copy and not a raw <p>.
      expect(screen.getByText(pattern)).toBeDefined();
    },
  );
});
