// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WatchlistErrorFallback } from "../components/watchlist-error-fallback";
import { watchlistKeys } from "../lib/query-keys";

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => cleanup());

describe("WatchlistErrorFallback", () => {
  // Regression: a plain `resetErrorBoundary()` leaves the failed
  // useSuspenseQuery in cache, so re-mounting the Suspense child surfaces
  // the same error immediately — retry feels like a no-op. The fallback
  // MUST reset the matching queries first so Suspense can refetch.
  it("falls back to resetting the watchlist root key when no queryKey is given", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const resetQueriesSpy = vi.spyOn(client, "resetQueries");
    const resetBoundary = vi.fn();
    const Wrapper = wrap(client);
    render(
      <Wrapper>
        <WatchlistErrorFallback
          error={new Error("rate limit")}
          resetErrorBoundary={resetBoundary}
        />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(resetQueriesSpy).toHaveBeenCalledWith({ queryKey: watchlistKeys.root });
    expect(resetBoundary).toHaveBeenCalledTimes(1);
  });

  // The page-level boundaries wire a specific section key so retry refetches
  // only the failed section instead of resuspending the entire curated page.
  it("resets only the supplied section queryKey on retry when provided", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const resetQueriesSpy = vi.spyOn(client, "resetQueries");
    const resetBoundary = vi.fn();
    const Wrapper = wrap(client);
    const tonightKey = watchlistKeys.tonight();
    render(
      <Wrapper>
        <WatchlistErrorFallback
          error={new Error("rate limit")}
          resetErrorBoundary={resetBoundary}
          queryKey={tonightKey}
        />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(resetQueriesSpy).toHaveBeenCalledWith({ queryKey: tonightKey });
    expect(resetBoundary).toHaveBeenCalledTimes(1);
  });
});
