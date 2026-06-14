// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { HomeLayoutResponse } from "@nama/shared/home";

import { setupVirtualizerEnv } from "../../../shared/components/virtualized/__tests__/virtualizer-test-env";

// Router: HomeFeedReady reads `useSearch`/`useNavigate`. Neither matters for the
// empty-vs-feed branch, so stub them to inert defaults and keep the rest real.
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  };
});

// Watchlist: the feed wires these in but the warming branch never reaches them;
// stub so the component tree mounts without the real query stack.
vi.mock("@/features/watchlist", () => ({
  useIsInWatchlist: () => false,
  useToggleWatchlist: () => vi.fn(),
}));

// Data layer: mock the home hooks (frontend rule 11 — mock the data hook, not
// React Query internals). `useHomeFeed` drives the branch under test;
// `useHomeDetails` is the closed-modal no-op.
const layoutRef = vi.hoisted(() => ({ value: null as HomeLayoutResponse | null }));
vi.mock("../hooks/use-home-feed", () => ({
  useHomeFeed: () => ({ data: layoutRef.value }),
}));
vi.mock("../hooks/use-home-details", () => ({
  useHomeDetails: () => ({ data: undefined }),
}));

import { HomeFeed } from "../components/home-feed";

let env: ReturnType<typeof setupVirtualizerEnv> | undefined;

function withClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => {
  cleanup();
  env?.cleanup();
  env = undefined;
  layoutRef.value = null;
});

describe("HomeFeed", () => {
  it("shows the warming state instead of a blank page when the layout is empty", () => {
    // WHY: a fresh install composes `{ hero: null, rows: [] }` until the
    // discover-snapshot job warms the catalog. Without the warming state the
    // feed renders nothing and the user sees a blank page (the original bug).
    layoutRef.value = { hero: null, rows: [], generatedAt: 1 };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<HomeFeed />, { wrapper: withClient(client) });

    // The warming empty state offers a single refresh action and renders no
    // virtualized rows.
    expect(screen.getByRole("button")).toBeTruthy();
    expect(document.querySelector("[data-index]")).toBeNull();
  });

  it("renders feed content when the layout has at least one row", async () => {
    // WHY: once the catalog warms the layout carries rows; the feed must render
    // the virtualized list rather than the warming state.
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 200, elementHeight: 300 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "movie:1",
              tmdbId: "1",
              mediaType: "movie",
              title: "Movie 1",
              poster: "https://example.com/1.jpg",
              backdrop: "https://example.com/1-bd.jpg",
            },
          ],
          cursor: null,
        }),
        { status: 200 },
      ),
    );
    layoutRef.value = {
      hero: null,
      rows: [
        {
          rowId: "trendingNow",
          kind: "trendingNow",
          titleKey: "home_row_trendingNow_header",
          initialCursor: null,
        },
      ],
      generatedAt: 1,
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<HomeFeed />, { wrapper: withClient(client) });

    await waitFor(() => expect(screen.getByText("Movie 1")).toBeTruthy());
  });
});
