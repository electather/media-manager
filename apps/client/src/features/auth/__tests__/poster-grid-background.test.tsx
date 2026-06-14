// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchersMock = vi.hoisted(() => ({
  fetchTrendingPosters: vi.fn(),
}));
vi.mock("../lib/fetchers", () => fetchersMock);

import { PosterGridBackground } from "../components/poster-grid-background";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

// Mounts the grid in a plain provider WITHOUT a Suspense boundary, proving the
// decorative grid never suspends and so can never block the login form.
function renderGrid() {
  const qc = makeClient();
  const utils = render(
    <QueryClientProvider client={qc}>
      <PosterGridBackground />
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

function makePoster(n: number) {
  return { id: `movie:${n}`, title: `Title ${n}`, poster: `https://img.example/${n}.jpg` };
}

// 6 rows x 14 cards, each duplicated x2 for the seamless loop.
const TOTAL_SLOTS = 6 * 14 * 2;

// The embossed placeholder is the base layer of every slot, so the count is
// fixed regardless of how many live posters resolve.
function placeholders(container: HTMLElement) {
  return container.querySelectorAll('[data-slot="poster-placeholder"]');
}

// Live poster <img>s carry an empty alt, so they expose the presentation role;
// placeholders are divs and do not.
function liveImages() {
  return screen.queryAllByRole("presentation", { hidden: true });
}

beforeEach(() => {
  fetchersMock.fetchTrendingPosters.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PosterGridBackground", () => {
  it("renders the full placeholder grid immediately while the query is pending without suspending", () => {
    // Never-resolving promise: if the component suspended this would throw with
    // no Suspense boundary, so reaching the assertions proves it does not gate.
    fetchersMock.fetchTrendingPosters.mockReturnValue(new Promise(() => {}));
    const { container } = renderGrid();

    expect(placeholders(container)).toHaveLength(TOTAL_SLOTS);
    // No live images while pending; every slot shows the embossed placeholder.
    expect(liveImages()).toHaveLength(0);
    // No title/tag/brand text overlay anywhere.
    expect(screen.queryByText(/Title/)).toBeNull();
  });

  it("overlays live posters as images over placeholders with no text overlay", async () => {
    const posters = Array.from({ length: 10 }, (_, i) => makePoster(i));
    fetchersMock.fetchTrendingPosters.mockResolvedValue(posters);
    const { container } = renderGrid();

    await waitFor(() => {
      // The 10 live posters appear once per loop copy = 20 occurrences.
      expect(liveImages()).toHaveLength(20);
    });

    for (const img of liveImages()) {
      expect(img.getAttribute("src")).toMatch(/^https:\/\/img\.example\//);
    }
    // The placeholder base remains under every slot, so the grid is never short.
    expect(placeholders(container)).toHaveLength(TOTAL_SLOTS);
    // No title text rendered for live posters.
    expect(screen.queryByText("Title 0")).toBeNull();
  });

  it("renders a full placeholder grid and no live images on empty response", async () => {
    fetchersMock.fetchTrendingPosters.mockResolvedValue([]);
    const { container } = renderGrid();

    await waitFor(() => {
      expect(fetchersMock.fetchTrendingPosters).toHaveBeenCalled();
    });
    expect(placeholders(container)).toHaveLength(TOTAL_SLOTS);
    expect(liveImages()).toHaveLength(0);
  });

  it("renders a full placeholder grid and no live images on query error", async () => {
    fetchersMock.fetchTrendingPosters.mockRejectedValue(new Error("boom"));
    const { container } = renderGrid();

    await waitFor(() => {
      expect(fetchersMock.fetchTrendingPosters).toHaveBeenCalled();
    });
    expect(placeholders(container)).toHaveLength(TOTAL_SLOTS);
    expect(liveImages()).toHaveLength(0);
  });

  it("drops a single broken live image to its placeholder without affecting siblings", async () => {
    const posters = Array.from({ length: 10 }, (_, i) => makePoster(i));
    fetchersMock.fetchTrendingPosters.mockResolvedValue(posters);
    renderGrid();

    await waitFor(() => {
      expect(liveImages()).toHaveLength(20);
    });

    const before = liveImages();
    const target = before[0]!;
    const targetSrc = target.getAttribute("src");

    fireEvent.error(target);

    const after = liveImages();
    // Exactly one card fell back to its placeholder; siblings are untouched.
    expect(after).toHaveLength(19);
    // Other live posters (different srcs) still render.
    expect(after.some((img) => img.getAttribute("src") !== targetSrc)).toBe(true);
  });
});
