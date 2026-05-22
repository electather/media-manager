// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupVirtualizerEnv } from "../../../shared/components/virtualized/__tests__/virtualizer-test-env";
import { WatchlistFilteredGrid } from "../components/watchlist-filtered-grid";
import type { WatchlistItem } from "../lib/types";

function makeItem(i: number): WatchlistItem {
  return {
    id: `movie:${i}`,
    tmdbId: String(i),
    mediaType: "movie",
    title: `Movie ${i}`,
    addedAt: i,
  } as WatchlistItem;
}

function withClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("WatchlistFilteredGrid", () => {
  let env: ReturnType<typeof setupVirtualizerEnv> | undefined;
  afterEach(() => {
    cleanup();
    env?.cleanup();
    env = undefined;
  });

  it("caps mounted cards via VirtualGrid at a 1024px viewport", () => {
    env = setupVirtualizerEnv({
      width: 1024,
      height: 800,
      elementWidth: 1024,
      elementHeight: 320,
    });
    const items = Array.from({ length: 200 }, (_, i) => makeItem(i));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<WatchlistFilteredGrid items={items} filter="all" sort="recent" onPeek={() => {}} />, {
      wrapper: withClient(client),
    });
    const rows = document.querySelectorAll("[data-index]");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(6);
  });
});
