// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompactMediaItem, HomeRowStub } from "@ent-mcp/shared/home";

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useRouter: () => ({ navigate: vi.fn() }) };
});

vi.mock("@/hooks/use-artwork", () => ({
  useArtwork: () => ({ data: undefined }),
  EMPTY_BUNDLE: { poster: [], backdrop: [], clearLogo: [], thumb: [] },
}));

const apiMock = vi.hoisted(() => ({ getRowContent: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: {
    home: {
      getRowContent: { $post: (args: unknown) => apiMock.getRowContent(args) },
    },
  },
}));

import { SidebarColumn } from "../sidebar-column";

const sidebarItems: CompactMediaItem[] = [
  {
    id: "tv:1",
    tmdbId: "1",
    mediaType: "tv",
    title: "Show A",
    backdrop: "a.jpg",
    episode: { season: 1, episode: 2, airsAt: Date.UTC(2026, 4, 1) },
  },
  {
    id: "tv:2",
    tmdbId: "2",
    mediaType: "tv",
    title: "Show B",
    backdrop: "b.jpg",
    episode: { season: 2, episode: 3, airsAt: Date.UTC(2026, 4, 2) },
  },
];

const row: HomeRowStub = {
  rowId: "upcomingForYou",
  title: "Upcoming",
  initialCursor: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderSidebar(stub: HomeRowStub) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SidebarColumn row={stub} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.getRowContent.mockReset();
  apiMock.getRowContent.mockResolvedValue(jsonResponse({ items: sidebarItems, cursor: null }));
});
afterEach(() => cleanup());

describe("SidebarColumn", () => {
  it("renders the row title", () => {
    renderSidebar(row);
    expect(screen.getByTestId("sidebar-title").textContent).toBe("Upcoming");
  });

  it("renders one SidebarItem per row item after loading", async () => {
    renderSidebar(row);
    await waitFor(() => {
      const list = screen.getByTestId("sidebar-list");
      const items = within(list).getAllByTestId("sidebar-item");
      expect(items.length).toBe(sidebarItems.length);
    });
  });

  it("declares the horizontal-scroll layout as the default (sub-md container width)", async () => {
    renderSidebar(row);
    await waitFor(() => {
      const list = screen.getByTestId("sidebar-list");
      expect(list.className).toContain("flex");
      expect(list.className).toContain("overflow-x-auto");
      const slides = within(list).getAllByTestId("sidebar-item");
      slides.forEach((item) => {
        const slide = item.parentElement!;
        expect(slide.className).toContain("w-[280px]");
        expect(slide.className).toContain("shrink-0");
      });
    });
  });

  it("declares the vertical-list override at the @[768px] breakpoint", async () => {
    renderSidebar(row);
    await waitFor(() => {
      const list = screen.getByTestId("sidebar-list");
      expect(list.className).toContain("@[768px]:flex-col");
      expect(list.className).toContain("@[768px]:overflow-visible");
      const items = within(list).getAllByTestId("sidebar-item");
      items.forEach((item) => {
        expect(item.parentElement!.className).toContain("@[768px]:w-auto");
      });
    });
  });
});
