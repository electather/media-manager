// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CompactMediaItem, RowContentResponse } from "@nama/shared/home";

import { setupVirtualizerEnv } from "../../../shared/components/virtualized/__tests__/virtualizer-test-env";
import { Row } from "../components/row/index";
import type { RowData } from "../lib/types";

let env: ReturnType<typeof setupVirtualizerEnv> | undefined;

afterEach(() => {
  cleanup();
  env?.cleanup();
  env = undefined;
});
beforeEach(() => vi.restoreAllMocks());

function withClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function item(id: string): CompactMediaItem {
  return {
    id: `movie:${id}`,
    tmdbId: id,
    mediaType: "movie",
    title: `Movie ${id}`,
    poster: `https://example.com/${id}.jpg`,
    backdrop: `https://example.com/${id}-bd.jpg`,
  };
}

function makeRow(overrides: Partial<RowData> = {}): RowData {
  return {
    id: "trendingNow",
    kind: "trendingNow",
    defaultAspect: "2/3",
    initialCursor: null,
    ...overrides,
  };
}

function mockRowFetch(items: CompactMediaItem[], opts: Partial<RowContentResponse> = {}) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ items, cursor: null, ...opts }), { status: 200 }),
  );
}

describe("Row", () => {
  it("renders items returned from /api/media/sources/:sourceId", async () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 200, elementHeight: 300 });
    mockRowFetch([item("x"), item("y"), item("z")]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<Row row={makeRow()} />, { wrapper: withClient(client) });
    await waitFor(() => expect(screen.getByText("Movie x")).toBeTruthy());
    expect(screen.getByText("Movie y")).toBeTruthy();
    expect(screen.getByText("Movie z")).toBeTruthy();
  });

  it("renders nothing when the row resolves with no items", async () => {
    // An empty (resolved, non-error) row collapses entirely — no heading, no
    // reserved track height — so a soft-degraded source (e.g. a rate-limited
    // calendar feed returning an empty partial page) leaves no blank gap in
    // the feed. The heading shows transiently while loading, then unmounts.
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 200, elementHeight: 300 });
    mockRowFetch([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<Row row={makeRow()} />, { wrapper: withClient(client) });
    await waitFor(() => expect(screen.queryByRole("heading")).toBeNull());
    expect(container.querySelector('[data-testid="row-scroller-bleed"]')).toBeNull();
  });

  it("renders skeleton placeholder cards while the row is loading", () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 200, elementHeight: 300 });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<Row row={makeRow()} />, { wrapper: withClient(client) });
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders a visible heading for the row", async () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 200, elementHeight: 300 });
    mockRowFetch([item("a")]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<Row row={makeRow()} />, { wrapper: withClient(client) });
    const heading = screen.getByRole("heading");
    expect(heading.textContent?.length).toBeGreaterThan(0);
  });

  it("renders an eyebrow when the row kind has one", async () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 200, elementHeight: 300 });
    mockRowFetch([item("a")]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <Row
        row={makeRow({
          id: "becauseYouWatched",
          kind: "becauseYouWatched",
          seedTitle: "Helios Run",
        })}
      />,
      { wrapper: withClient(client) },
    );
    expect(screen.getByText(/themed picks/i)).toBeTruthy();
  });

  it("keeps the card scroller inside the page's max-width container so the first card aligns with the title", () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 200, elementHeight: 300 });
    mockRowFetch([item("a")]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<Row row={makeRow()} />, { wrapper: withClient(client) });
    const bleed = container.querySelector('[data-testid="row-scroller-bleed"]');
    expect(bleed).toBeTruthy();
    expect(bleed?.className).not.toContain("w-screen");
    expect(bleed?.className).not.toContain("translate-x");
  });

  it("caps mounted cards via virtualization", async () => {
    env = setupVirtualizerEnv({ width: 1024, height: 800, elementWidth: 200, elementHeight: 300 });
    const items = Array.from({ length: 100 }, (_, i) => item(String(i)));
    mockRowFetch(items);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<Row row={makeRow()} />, { wrapper: withClient(client) });
    await waitFor(() => expect(screen.getByText("Movie 0")).toBeTruthy());
    const cells = document.querySelectorAll('[data-slot="scroll-row-item"]');
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(16);
  });

  it("fires fetchNextPage when the visible range crosses the prefetch threshold", async () => {
    env = setupVirtualizerEnv({ width: 800, height: 600, elementWidth: 200, elementHeight: 300 });
    const calls: number[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      calls.push(Date.now());
      const isFirst = calls.length === 1;
      const body = isFirst
        ? { items: Array.from({ length: 6 }, (_, i) => item(String(i))), cursor: "page2" }
        : { items: Array.from({ length: 4 }, (_, i) => item(`p2-${i}`)), cursor: null };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<Row row={makeRow()} />, { wrapper: withClient(client) });
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    expect(calls.length).toBeLessThanOrEqual(3);
  });
});
