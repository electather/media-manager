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

const { useArtwork, useArtworkIfMissing } = await import("../use-artwork");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bundle(overrides: Partial<ArtworkBundle> = {}): ArtworkBundle {
  return { poster: [], backdrop: [], clearLogo: [], thumb: [], ...overrides };
}

function Probe({
  id,
  type = "movie",
  enabled,
}: {
  id: string;
  type?: "movie" | "tv";
  enabled?: boolean;
}) {
  const result = useArtwork({ key: `${type}:${id}`, ids: { tmdb: id }, type }, { enabled });
  if (result.isFetching) return <span data-testid={`art-${id}`}>fetching</span>;
  if (!result.data) return <span data-testid={`art-${id}`}>idle</span>;
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

describe("useArtwork per-item dispatch", () => {
  it("issues one POST per useArtwork call, each containing exactly that item", async () => {
    apiMock.getArtwork.mockImplementation((args?: { json: { items: Array<{ key: string }> } }) => {
      const items = args?.json?.items ?? [];
      return Promise.resolve(
        jsonResponse({
          results: Object.fromEntries(
            items.map((item) => [
              item.key,
              bundle({ poster: [{ url: `https://x/${item.key}.jpg`, language: "en" }] }),
            ]),
          ),
          generatedAt: 1,
        }),
      );
    });
    renderWithClient(
      <>
        <Probe id="1" />
        <Probe id="2" />
        <Probe id="3" />
      </>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("art-1").textContent).toBe("https://x/movie:1.jpg");
      expect(screen.getByTestId("art-2").textContent).toBe("https://x/movie:2.jpg");
      expect(screen.getByTestId("art-3").textContent).toBe("https://x/movie:3.jpg");
    });
    expect(apiMock.getArtwork).toHaveBeenCalledTimes(3);
    for (const call of apiMock.getArtwork.mock.calls) {
      const [payload] = call as [{ json: { items: unknown[] } }];
      expect(payload.json.items).toHaveLength(1);
    }
  });

  it("deduplicates identical keys via tanstack-query — two cards = one POST", async () => {
    apiMock.getArtwork.mockResolvedValue(
      jsonResponse({
        results: { "movie:7": bundle({ poster: [{ url: "https://x/7.jpg", language: "en" }] }) },
        generatedAt: 1,
      }),
    );
    renderWithClient(
      <>
        <Probe id="7" />
        <Probe id="7" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId("art-7")).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getAllByTestId("art-7")[0]!.textContent).toBe("https://x/7.jpg"),
    );
    expect(apiMock.getArtwork).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when enabled is false (below-fold gating)", async () => {
    apiMock.getArtwork.mockResolvedValue(jsonResponse({ results: {}, generatedAt: 1 }));
    renderWithClient(<Probe id="42" enabled={false} />);
    // Wait one microtask cycle to give react-query a chance to misbehave.
    await Promise.resolve();
    expect(apiMock.getArtwork).not.toHaveBeenCalled();
    expect(screen.getByTestId("art-42").textContent).toBe("idle");
  });

  it("falls back to the empty bundle when the server returns no entry for a key", async () => {
    apiMock.getArtwork.mockResolvedValue(jsonResponse({ results: {}, generatedAt: 1 }));
    renderWithClient(<Probe id="99" />);
    await waitFor(() => expect(screen.getByTestId("art-99").textContent).toBe("(none)"));
  });
});

function MissingProbe({
  id,
  type = "movie" as "movie" | "tv",
  poster,
  backdrop,
  clearLogo,
  required,
  enabled,
}: {
  id: string;
  type?: "movie" | "tv";
  poster?: string | null;
  backdrop?: string | null;
  clearLogo?: string | null;
  required: Array<"poster" | "backdrop" | "clearLogo">;
  enabled?: boolean;
}) {
  const result = useArtworkIfMissing(
    { key: `${type}:${id}`, ids: { tmdb: id }, type, poster, backdrop, clearLogo },
    required,
    { enabled },
  );
  if (result.isFetching) return <span data-testid={`mp-${id}`}>fetching</span>;
  const url = result.data?.poster[0]?.url ?? "(none)";
  const bd = result.data?.backdrop[0]?.url ?? "(none)";
  const cl = result.data?.clearLogo[0]?.url ?? "(none)";
  return <span data-testid={`mp-${id}`}>{`${url}|${bd}|${cl}`}</span>;
}

describe("useArtworkIfMissing", () => {
  it("synthesizes the bundle from inline slots without firing a request", async () => {
    apiMock.getArtwork.mockResolvedValue(jsonResponse({ results: {}, generatedAt: 1 }));
    renderWithClient(
      <MissingProbe
        id="1"
        poster="https://x/p.jpg"
        backdrop="https://x/bd.jpg"
        clearLogo="https://x/cl.png"
        required={["poster", "backdrop", "clearLogo"]}
      />,
    );
    await Promise.resolve();
    expect(apiMock.getArtwork).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("mp-1").textContent).toBe(
        "https://x/p.jpg|https://x/bd.jpg|https://x/cl.png",
      ),
    );
  });

  it("fires the network call when one required slot is missing", async () => {
    apiMock.getArtwork.mockResolvedValue(
      jsonResponse({
        results: {
          "movie:2": bundle({
            poster: [{ url: "https://x/fetched.jpg", language: "en" }],
            backdrop: [{ url: "https://x/fetched-bd.jpg", language: "en" }],
            clearLogo: [{ url: "https://x/fetched-cl.png", language: "en" }],
          }),
        },
        generatedAt: 1,
      }),
    );
    renderWithClient(
      <MissingProbe id="2" poster="https://x/inline-p.jpg" required={["poster", "backdrop"]} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("mp-2").textContent).toContain("https://x/fetched.jpg"),
    );
    expect(apiMock.getArtwork).toHaveBeenCalledTimes(1);
  });

  it("respects enabled=false even when slots are missing", async () => {
    apiMock.getArtwork.mockResolvedValue(jsonResponse({ results: {}, generatedAt: 1 }));
    renderWithClient(<MissingProbe id="3" required={["poster"]} enabled={false} />);
    await Promise.resolve();
    expect(apiMock.getArtwork).not.toHaveBeenCalled();
  });

  it("synthesizes a bundle with empty arrays for slots not declared required", async () => {
    apiMock.getArtwork.mockResolvedValue(jsonResponse({ results: {}, generatedAt: 1 }));
    renderWithClient(<MissingProbe id="4" poster="https://x/only-p.jpg" required={["poster"]} />);
    await waitFor(() =>
      expect(screen.getByTestId("mp-4").textContent).toBe("https://x/only-p.jpg|(none)|(none)"),
    );
    expect(apiMock.getArtwork).not.toHaveBeenCalled();
  });
});
