// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { MediaDetailsResponse } from "@ent-mcp/shared/home";
import { MediaDetailPage } from "../components/media-detail-page";
import { useMediaItem } from "../lib/find-item";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children?: ReactNode }) => (
    <a {...(props as object)}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock("@/shared/lib/diagnostics/report", () => ({
  reportError: vi.fn(async () => {}),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function wrap(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const payload: MediaDetailsResponse = {
  summary: {
    id: "movie:550",
    tmdbId: "550",
    mediaType: "movie",
    title: "Fight Club",
    status: "available",
  },
  details: { cast: ["Edward"], director: "Fincher" },
};

describe("useMediaItem", () => {
  it("resolves a composite id via /api/home/details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMediaItem("movie:550"), { wrapper: wrap(client) });
    await waitFor(() => expect(result.current.item?.title).toBe("Fight Club"));
    expect(result.current.item?.cast).toEqual(["Edward"]);
    expect(result.current.item?.director).toBe("Fincher");
  });

  it("returns the summary item and details fallback code when details are unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...payload,
          details: null,
          error: { code: "plugin.timeout" },
        } satisfies MediaDetailsResponse),
        { status: 200 },
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMediaItem("movie:550"), { wrapper: wrap(client) });

    await waitFor(() => expect(result.current.item?.title).toBe("Fight Club"));
    expect(result.current.item?.cast).toBeUndefined();
    expect(result.current.detailsErrorCode).toBe("plugin.timeout");
    expect(result.current.isError).toBe(false);
  });

  it("renders the summary page with degraded-state copy for details fallback responses", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/home/details")) {
        return new Response(
          JSON.stringify({
            summary: {
              id: "movie:550",
              tmdbId: "550",
              mediaType: "movie",
              title: "Fight Club",
              status: "available",
              overview: "A summary survives the details failure.",
            },
            details: null,
            error: { code: "plugin.timeout" },
          } satisfies MediaDetailsResponse),
          { status: 200 },
        );
      }
      if (url.includes("/api/home/row")) {
        return new Response(JSON.stringify({ items: [], cursor: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MediaDetailPage compositeId="movie:550" />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: "Fight Club" })).toBeTruthy(),
    );
    expect(screen.getByText("A summary survives the details failure.")).toBeTruthy();
    expect(screen.getByText(/Some details did not load/i)).toBeTruthy();
    expect(screen.getByText(/plugin\.timeout/i)).toBeTruthy();
  });

  it("does not show degraded-state copy for query failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          summary: {
            id: "movie:550",
            tmdbId: "550",
            mediaType: "movie",
            title: "Fight Club",
            status: "available",
            overview: "A summary survives the details failure.",
          },
        }),
        { status: 500 },
      ),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MediaDetailPage compositeId="movie:550" />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText(/We couldn't find that title/i)).toBeTruthy());
    expect(screen.queryByText(/Some details did not load/i)).toBeNull();
  });

  it("returns null while the query is pending", async () => {
    let resolveFetch: (response: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMediaItem("movie:550"), { wrapper: wrap(client) });
    expect(result.current.item).toBeNull();
    expect(result.current.isLoading).toBe(true);
    resolveFetch(new Response(JSON.stringify(payload), { status: 200 }));
    await waitFor(() => expect(result.current.item?.title).toBe("Fight Club"));
  });

  it("returns null for malformed composite ids", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useMediaItem("not-a-composite"), { wrapper: wrap(client) });
    expect(result.current.item).toBeNull();
  });
});
