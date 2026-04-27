// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";

const apiMock = vi.hoisted(() => ({ getLayout: vi.fn(), getArtwork: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: {
    home: {
      getLayout: { $post: (args: unknown) => apiMock.getLayout(args) },
      getRowContent: { $post: vi.fn() },
    },
    artwork: {
      get: { $post: (args: unknown) => apiMock.getArtwork(args) },
    },
  },
}));

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useRouter: () => ({ navigate: vi.fn() }),
    useNavigate: () => vi.fn(),
  };
});

import { HomeFeed } from "../home-feed";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderFeed() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomeFeed />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.getLayout.mockReset();
  apiMock.getArtwork.mockReset();
  // Default: artwork.get resolves to an empty results map so cards fall back
  // to inline poster/backdrop fields. Per-test overrides via mockResolvedValue.
  apiMock.getArtwork.mockResolvedValue(jsonResponse({ results: {}, generatedAt: 1 }));
});
afterEach(() => cleanup());

describe("HomeFeed branches", () => {
  it("renders the empty state when both hero and rows are empty", async () => {
    apiMock.getLayout.mockResolvedValueOnce(
      jsonResponse({ hero: null, rows: [], generatedAt: 1 } satisfies HomeLayoutResponse),
    );
    renderFeed();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Connect a service/i })).toBeTruthy(),
    );
  });

  it("renders the error state with a working retry button on failure", async () => {
    apiMock.getLayout.mockResolvedValueOnce(jsonResponse({}, 500));
    renderFeed();
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy());
  });

  it("renders the row titles when rows are present", async () => {
    apiMock.getLayout.mockResolvedValueOnce(
      jsonResponse({
        hero: null,
        rows: [
          { rowId: "trendingNow", title: "Trending now", items: [], cursor: null },
          { rowId: "newReleases", title: "New releases", items: [], cursor: null },
        ],
        generatedAt: 1,
      } satisfies HomeLayoutResponse),
    );
    renderFeed();
    await waitFor(() => {
      expect(screen.getByText("Trending now")).toBeTruthy();
      expect(screen.getByText("New releases")).toBeTruthy();
    });
  });

  it("renders the top-zone composition when hero and sidebar are both present", async () => {
    apiMock.getLayout.mockResolvedValueOnce(
      jsonResponse({
        hero: {
          item: {
            id: "movie:550",
            tmdbId: "550",
            mediaType: "movie",
            title: "Fight Club",
            backdrop: "b",
          },
          source: "trendingNow",
          reason: "trending",
          resumeUrl: null,
        },
        rows: [
          {
            rowId: "upcomingForYou",
            title: "Upcoming",
            items: [
              {
                id: "tv:1",
                tmdbId: "1",
                mediaType: "tv",
                title: "Show",
                episode: { season: 1, episode: 2, airsAt: Date.UTC(2026, 4, 1) },
              },
            ],
            cursor: null,
          },
          { rowId: "trendingNow", title: "Trending now", items: [], cursor: null },
        ],
        generatedAt: 1,
      } satisfies HomeLayoutResponse),
    );
    renderFeed();
    await waitFor(() => {
      expect(screen.getByTestId("top-zone")).toBeTruthy();
      expect(screen.getByTestId("home-hero")).toBeTruthy();
      expect(screen.getByTestId("sidebar-title")).toBeTruthy();
    });
  });

  it("promotes the sidebar row into the main feed when the hero is absent", async () => {
    apiMock.getLayout.mockResolvedValueOnce(
      jsonResponse({
        hero: null,
        rows: [
          {
            rowId: "upcomingForYou",
            title: "Upcoming",
            items: [
              {
                id: "tv:1",
                tmdbId: "1",
                mediaType: "tv",
                title: "Show",
                episode: { season: 1, episode: 2, airsAt: Date.UTC(2026, 4, 1) },
              },
            ],
            cursor: null,
          },
          { rowId: "trendingNow", title: "Trending now", items: [], cursor: null },
        ],
        generatedAt: 1,
      } satisfies HomeLayoutResponse),
    );
    renderFeed();
    // No hero + no sidebar partner → TopZone short-circuits to null.
    await waitFor(() => expect(screen.getByText("Upcoming")).toBeTruthy());
    expect(screen.queryByTestId("top-zone")).toBeNull();
    expect(screen.queryByTestId("home-hero")).toBeNull();
    // Sidebar row title now appears as a regular row heading.
    const headings = screen.getAllByTestId("row-title").map((el) => el.textContent);
    expect(headings).toContain("Upcoming");
    expect(headings).toContain("Trending now");
    // And it leads — promoted to the head of the rows array.
    expect(headings[0]).toBe("Upcoming");
  });
});
