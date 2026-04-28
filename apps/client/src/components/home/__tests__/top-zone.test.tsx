// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HomeRowStub, LayoutHero } from "@ent-mcp/shared/home";

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useRouter: () => ({ navigate: vi.fn() }) };
});

vi.mock("@/hooks/use-artwork", () => ({
  useArtwork: () => ({ data: undefined }),
  useArtworkIfMissing: () => ({ data: undefined }),
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

import { TopZone } from "../top-zone";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderZone(props: Parameters<typeof TopZone>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TopZone {...props} />
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

const hero: LayoutHero = {
  item: { id: "movie:550", tmdbId: "550", mediaType: "movie", title: "Fight Club", backdrop: "b" },
  source: "recommendedForYou",
  reason: "recommended",
  resumeUrl: null,
};

const sidebarRow: HomeRowStub = {
  rowId: "upcomingForYou",
  title: "Upcoming",
  initialCursor: null,
};

describe("TopZone composition", () => {
  it("renders both hero and sidebar when both are present", async () => {
    apiMock.getRowContent.mockResolvedValue(jsonResponse({ items: [], cursor: null }));
    renderZone({ hero, sidebarRow });
    await waitFor(() => {
      expect(screen.getByTestId("home-hero")).toBeTruthy();
      expect(screen.getByTestId("sidebar-title")).toBeTruthy();
    });
  });

  it("renders nothing when both are absent", () => {
    const { container } = renderZone({ hero: null, sidebarRow: null });
    expect(container.firstChild).toBeNull();
  });

  it("renders only the hero when sidebar is null", async () => {
    renderZone({ hero, sidebarRow: null });
    await waitFor(() => expect(screen.getByTestId("home-hero")).toBeTruthy());
    expect(screen.queryByTestId("sidebar-title")).toBeNull();
  });

  it("renders only the sidebar when hero is null", async () => {
    apiMock.getRowContent.mockResolvedValue(jsonResponse({ items: [], cursor: null }));
    renderZone({ hero: null, sidebarRow });
    await waitFor(() => expect(screen.getByTestId("sidebar-title")).toBeTruthy());
    expect(screen.queryByTestId("home-hero")).toBeNull();
  });
});
