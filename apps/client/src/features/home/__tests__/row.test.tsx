// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { CompactMediaItem, RowContentResponse } from "@ent-mcp/shared/home";

import { Row } from "../components/row/index";
import type { RowData } from "../lib/types";

afterEach(() => cleanup());
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
  it("renders items returned from /api/home/row", async () => {
    mockRowFetch([item("x"), item("y"), item("z")]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<Row row={makeRow()} />, { wrapper: withClient(client) });
    await waitFor(() => expect(screen.getByText("Movie x")).toBeTruthy());
    expect(screen.getByText("Movie y")).toBeTruthy();
    expect(screen.getByText("Movie z")).toBeTruthy();
  });

  it("renders skeleton placeholder cards while the row is loading", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<Row row={makeRow()} />, { wrapper: withClient(client) });
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders a visible heading for the row", async () => {
    mockRowFetch([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<Row row={makeRow()} />, { wrapper: withClient(client) });
    const heading = screen.getByRole("heading");
    expect(heading.textContent?.length).toBeGreaterThan(0);
  });

  it("renders a subtitle when the row kind has one", async () => {
    mockRowFetch([]);
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
    mockRowFetch([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<Row row={makeRow()} />, { wrapper: withClient(client) });
    const bleed = container.querySelector('[data-testid="row-scroller-bleed"]');
    expect(bleed).toBeTruthy();
    expect(bleed?.className).not.toContain("w-screen");
    expect(bleed?.className).not.toContain("translate-x");
  });
});
