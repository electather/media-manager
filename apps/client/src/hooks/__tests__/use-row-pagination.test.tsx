// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompactMediaItem } from "@ent-mcp/shared/home";

const apiMock = vi.hoisted(() => ({ getRowContent: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: {
    home: {
      getRowContent: { $post: (args: unknown) => apiMock.getRowContent(args) },
    },
  },
}));

import { useRowPagination } from "../use-row-pagination";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const item = (id: string): CompactMediaItem => ({
  id,
  tmdbId: id.split(":")[1]!,
  mediaType: "movie",
  title: id,
});

function Probe(props: Parameters<typeof useRowPagination>[0]) {
  const r = useRowPagination(props);
  return (
    <div>
      <div data-testid="items">{r.items.map((i) => i.id).join(",")}</div>
      <div data-testid="cursor">{r.cursor ?? "null"}</div>
      <div data-testid="has-more">{String(r.hasMore)}</div>
      <div data-testid="pending">{String(r.isPending)}</div>
      <button type="button" onClick={() => r.fetchNext()}>
        next
      </button>
    </div>
  );
}

function renderProbe(props: Parameters<typeof useRowPagination>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Probe {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiMock.getRowContent.mockReset());
afterEach(() => cleanup());

describe("useRowPagination", () => {
  it("fetches first page on mount with null cursor", async () => {
    apiMock.getRowContent.mockResolvedValueOnce(
      jsonResponse({ items: [item("movie:1"), item("movie:2")], cursor: "c1" }),
    );
    renderProbe({ rowId: "trendingNow", initialCursor: null });
    await waitFor(() => {
      expect(screen.getByTestId("items").textContent).toBe("movie:1,movie:2");
      expect(screen.getByTestId("cursor").textContent).toBe("c1");
      expect(screen.getByTestId("has-more").textContent).toBe("true");
    });
    expect(apiMock.getRowContent).toHaveBeenCalledWith(
      expect.objectContaining({ json: { rowId: "trendingNow", cursor: null } }),
    );
  });

  it("fetches first page on mount with a seed cursor (becauseYouWatched)", async () => {
    const seedCursor = "seed-cursor-abc";
    apiMock.getRowContent.mockResolvedValueOnce(
      jsonResponse({ items: [item("movie:5")], cursor: null }),
    );
    renderProbe({ rowId: "becauseYouWatched", initialCursor: seedCursor });
    await waitFor(() => {
      expect(screen.getByTestId("items").textContent).toBe("movie:5");
    });
    expect(apiMock.getRowContent).toHaveBeenCalledWith(
      expect.objectContaining({ json: { rowId: "becauseYouWatched", cursor: seedCursor } }),
    );
  });

  it("appends the next page on fetchNext and stops when cursor is null", async () => {
    apiMock.getRowContent
      .mockResolvedValueOnce(jsonResponse({ items: [item("movie:1")], cursor: "c1" }))
      .mockResolvedValueOnce(jsonResponse({ items: [item("movie:3")], cursor: null }));
    const user = userEvent.setup();
    renderProbe({ rowId: "trendingNow", initialCursor: null });
    await waitFor(() => expect(screen.getByTestId("items").textContent).toBe("movie:1"));
    await user.click(screen.getByText("next"));
    await waitFor(() => {
      expect(screen.getByTestId("items").textContent).toBe("movie:1,movie:3");
      expect(screen.getByTestId("has-more").textContent).toBe("false");
    });
  });

  it("calls onUnavailable when the server returns home.row_unavailable", async () => {
    apiMock.getRowContent.mockResolvedValueOnce(
      jsonResponse({ code: "home.row_unavailable", message: "gone" }, 404),
    );
    const onUnavailable = vi.fn();
    renderProbe({ rowId: "trendingNow", initialCursor: null, onUnavailable });
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1));
  });
});
