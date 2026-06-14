// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const fetchersMock = vi.hoisted(() => ({
  fetchTrendingPosters: vi.fn(),
}));
vi.mock("../lib/fetchers", () => fetchersMock);

// Stub the bundled SVG asset imports so jsdom/happy-dom resolves them to
// predictable string URLs; the real Vite import returns hashed URLs.
vi.mock("../assets/fallback-posters", () => ({
  FALLBACK_POSTERS: Array.from({ length: 10 }, (_, i) => `/fallback-${i}.svg`),
  fallbackPosterFor: (i: number) => `/fallback-${i % 10}.svg`,
}));

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
const TOTAL_IMAGES = 6 * 14 * 2;

beforeEach(() => {
  fetchersMock.fetchTrendingPosters.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PosterGridBackground", () => {
  it("renders the full fallback grid immediately while the query is pending without suspending", () => {
    // Never-resolving promise: if the component suspended this would throw with
    // no Suspense boundary, so reaching the assertions proves it does not gate.
    fetchersMock.fetchTrendingPosters.mockReturnValue(new Promise(() => {}));
    renderGrid();

    const imgs = screen.getAllByRole("presentation", { hidden: true });
    expect(imgs).toHaveLength(TOTAL_IMAGES);
    // Every slot is fallback art while pending.
    for (const img of imgs) {
      expect(img.getAttribute("src")).toMatch(/^\/fallback-\d+\.svg$/);
    }
    // No title/tag/brand text overlay anywhere.
    expect(screen.queryByText(/Title/)).toBeNull();
  });

  it("maps live posters onto the grid as images with no text overlay and fills the rest with fallback", async () => {
    const posters = Array.from({ length: 10 }, (_, i) => makePoster(i));
    fetchersMock.fetchTrendingPosters.mockResolvedValue(posters);
    renderGrid();

    await waitFor(() => {
      const imgs = screen.getAllByRole("presentation", { hidden: true });
      // The 10 live posters appear (once per loop copy = 20 occurrences).
      const liveSrcs = imgs
        .map((img) => img.getAttribute("src"))
        .filter((src) => src?.startsWith("https://img.example/"));
      expect(liveSrcs.length).toBe(20);
    });

    const imgs = screen.getAllByRole("presentation", { hidden: true });
    const fallbackCount = imgs.filter((img) =>
      img.getAttribute("src")?.startsWith("/fallback-"),
    ).length;
    // Remaining slots are filled with fallback art so the grid is never short.
    expect(fallbackCount).toBeGreaterThan(0);
    expect(imgs).toHaveLength(TOTAL_IMAGES);
    // No title text rendered for live posters.
    expect(screen.queryByText("Title 0")).toBeNull();
  });

  it("renders a full fallback grid on empty response", async () => {
    fetchersMock.fetchTrendingPosters.mockResolvedValue([]);
    renderGrid();

    await waitFor(() => {
      expect(fetchersMock.fetchTrendingPosters).toHaveBeenCalled();
    });
    const imgs = screen.getAllByRole("presentation", { hidden: true });
    expect(imgs).toHaveLength(TOTAL_IMAGES);
    for (const img of imgs) {
      expect(img.getAttribute("src")).toMatch(/^\/fallback-\d+\.svg$/);
    }
  });

  it("renders a full fallback grid on query error", async () => {
    fetchersMock.fetchTrendingPosters.mockRejectedValue(new Error("boom"));
    renderGrid();

    await waitFor(() => {
      expect(fetchersMock.fetchTrendingPosters).toHaveBeenCalled();
    });
    const imgs = screen.getAllByRole("presentation", { hidden: true });
    expect(imgs).toHaveLength(TOTAL_IMAGES);
    for (const img of imgs) {
      expect(img.getAttribute("src")).toMatch(/^\/fallback-\d+\.svg$/);
    }
  });

  it("swaps a single broken live image to fallback without affecting siblings", async () => {
    const posters = Array.from({ length: 10 }, (_, i) => makePoster(i));
    fetchersMock.fetchTrendingPosters.mockResolvedValue(posters);
    renderGrid();

    await waitFor(() => {
      const live = screen
        .getAllByRole("presentation", { hidden: true })
        .filter((img) => img.getAttribute("src")?.startsWith("https://img.example/"));
      expect(live.length).toBeGreaterThan(0);
    });

    const liveImgs = screen
      .getAllByRole("presentation", { hidden: true })
      .filter((img) => img.getAttribute("src")?.startsWith("https://img.example/"));
    const target = liveImgs[0]!;
    const siblingSrc = liveImgs[1]!.getAttribute("src");

    fireEvent.error(target);

    // The broken card swapped to fallback art.
    expect(target.getAttribute("src")).toMatch(/^\/fallback-\d+\.svg$/);
    // A sibling live image is untouched.
    expect(liveImgs[1]!.getAttribute("src")).toBe(siblingSrc);
  });
});
