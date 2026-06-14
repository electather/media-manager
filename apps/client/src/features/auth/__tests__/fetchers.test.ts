// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Mock the Hono client transport (rule 11: mock the fetcher's transport, never
// React Query). `readOkJson` runs for real against the mocked Response.
const apiMock = vi.hoisted(() => ({ trendingGet: vi.fn() }));

vi.mock("@/shared/lib/api", () => ({
  api: { public: { trending: { $get: (args: unknown) => apiMock.trendingGet(args) } } },
}));

const { fetchTrendingPosters } = await import("../lib/fetchers");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => apiMock.trendingGet.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("fetchTrendingPosters", () => {
  it("threads the limit into the request as a string and returns the posters", async () => {
    // The grid requests exactly its full card count; a refactor that dropped the
    // limit would silently fall back to the server's 48-item default and leave
    // the grid short, so pin that the requested limit is forwarded verbatim.
    const posters = [{ id: "movie:550", title: "Fight Club", poster: "/fc.jpg" }];
    apiMock.trendingGet.mockResolvedValueOnce(jsonResponse({ posters }));
    const result = await fetchTrendingPosters(84);
    expect(apiMock.trendingGet).toHaveBeenCalledWith({ query: { limit: "84" } });
    expect(result).toEqual(posters);
  });
});
