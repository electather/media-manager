// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ArtworkBundle } from "@ent-mcp/shared/artwork";

const apiMock = vi.hoisted(() => ({ getArtwork: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: {
    artwork: {
      get: { $post: (args: unknown) => apiMock.getArtwork(args) },
    },
  },
}));

const { useArtwork } = await import("../use-artwork");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bundle(overrides: Partial<ArtworkBundle> = {}): ArtworkBundle {
  return { poster: [], backdrop: [], clearLogo: [], thumb: [], ...overrides };
}

function Probe({ id, type = "movie" }: { id: string; type?: "movie" | "tv" }) {
  const result = useArtwork({
    key: `${type}:${id}`,
    ids: { tmdb: id },
    type,
  });
  if (!result.data) return <span data-testid={`art-${id}`}>pending</span>;
  const url = result.data.poster[0]?.url ?? "(none)";
  return <span data-testid={`art-${id}`}>{url}</span>;
}

function renderWithClient(ui: React.ReactNode) {
  // `gcTime: 0` ensures every test starts from a clean cache despite the
  // hook's long staleTime in production.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => apiMock.getArtwork.mockReset());
afterEach(() => cleanup());

describe("useArtwork batching", () => {
  it("collapses multiple concurrent useArtwork calls into a single POST", async () => {
    apiMock.getArtwork.mockResolvedValueOnce(
      jsonResponse({
        results: {
          "movie:1": bundle({ poster: [{ url: "https://x/1.jpg", language: "en" }] }),
          "movie:2": bundle({ poster: [{ url: "https://x/2.jpg", language: "en" }] }),
          "movie:3": bundle({ poster: [{ url: "https://x/3.jpg", language: "en" }] }),
        },
        generatedAt: 1,
      }),
    );
    renderWithClient(
      <>
        <Probe id="1" />
        <Probe id="2" />
        <Probe id="3" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("art-1").textContent).toBe("https://x/1.jpg"));
    expect(screen.getByTestId("art-2").textContent).toBe("https://x/2.jpg");
    expect(screen.getByTestId("art-3").textContent).toBe("https://x/3.jpg");
    expect(apiMock.getArtwork).toHaveBeenCalledTimes(1);
    const [payload] = apiMock.getArtwork.mock.calls[0]!;
    expect(payload.json.items).toHaveLength(3);
  });

  it("falls back to a stable empty bundle when the server returns no entry for a key", async () => {
    apiMock.getArtwork.mockResolvedValueOnce(jsonResponse({ results: {}, generatedAt: 1 }));
    renderWithClient(<Probe id="42" />);
    await waitFor(() => expect(screen.getByTestId("art-42").textContent).toBe("(none)"));
  });

  it("splits more than 50 pending items into multiple ≤50-item batches", async () => {
    apiMock.getArtwork.mockResolvedValue(jsonResponse({ results: {}, generatedAt: 1 }));
    const probes = Array.from({ length: 75 }, (_, i) => <Probe key={i} id={String(i + 1)} />);
    renderWithClient(<>{probes}</>);
    await waitFor(() => expect(apiMock.getArtwork).toHaveBeenCalledTimes(2));
    const [first] = apiMock.getArtwork.mock.calls[0]!;
    const [second] = apiMock.getArtwork.mock.calls[1]!;
    expect(first.json.items.length).toBe(50);
    expect(second.json.items.length).toBe(25);
  });
});
