// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HomeLayoutResponse } from "@ent-mcp/shared/home";

const apiMock = vi.hoisted(() => ({ getLayout: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: {
    home: {
      getLayout: { $post: (args: unknown) => apiMock.getLayout(args) },
      getRowContent: { $post: vi.fn() },
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

beforeEach(() => apiMock.getLayout.mockReset());
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
});
