// @vitest-environment happy-dom
import { Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MoodMosaic } from "../components/sections/mood-mosaic";
import { watchlistKeys } from "../lib/query-keys";

// Stub the mood summary and the mood-item page fetchers so tests stay
// network-free.
const { fetchMoodsMock, fetchPageMock } = vi.hoisted(() => ({
  fetchMoodsMock: vi.fn(),
  fetchPageMock: vi.fn(),
}));
vi.mock("@/shared/media/aggregates", () => ({
  fetchMoods: fetchMoodsMock,
}));
vi.mock("@/shared/media/source", () => ({
  defineMediaSource: (spec: Record<string, unknown>) => ({ ...spec, fetchPage: fetchPageMock }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Suppress React's noisy uncaught-error logs during ErrorBoundary tests.
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
});
afterEach(() => {
  console.error = originalConsoleError;
  cleanup();
  vi.clearAllMocks();
});

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="loading" />}>{children}</Suspense>
    </QueryClientProvider>
  );
}

describe("MoodMosaic — cluster error boundary wiring", () => {
  // Regression: the previous fallback was `() => null` so a cluster fetch
  // failure silently collapsed the card. The boundary now passes
  // `watchlistKeys.moodItems(c.moodId)` to WatchlistErrorFallback so the
  // user sees a retry affordance scoped to the failing cluster.
  it("renders WatchlistErrorFallback instead of collapsing when a cluster fetch errors", async () => {
    fetchMoodsMock.mockResolvedValue({ clusters: [{ moodId: "cozy", count: 5 }] });
    fetchPageMock.mockRejectedValue(new Error("network error"));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = wrap(client);

    render(
      <Wrapper>
        <MoodMosaic />
      </Wrapper>,
    );

    // Wait for the error boundary to catch the cluster fetch failure.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
    });

    // The cache key targeted by the retry button must be the cluster's own
    // moodItems key, not the root key, so retry is scoped to the one cluster.
    const resetQueriesSpy = vi.spyOn(client, "resetQueries");
    act(() => {
      screen.getByRole("button", { name: /retry/i }).click();
    });
    expect(resetQueriesSpy).toHaveBeenCalledWith({
      queryKey: watchlistKeys.moodItems("cozy"),
    });
  });
});
