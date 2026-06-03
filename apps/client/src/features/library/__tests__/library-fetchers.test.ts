// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Page } from "@ent-mcp/shared/media";

// Mock the Hono client (rule 11: mock the fetchers' transport, never React
// Query). Both library transports are covered: the unified media-source
// resolver the four item lenses ride, and the library-owned collections +
// facets endpoints.
const apiMock = vi.hoisted(() => ({
  sourceGet: vi.fn(),
  collectionsGet: vi.fn(),
  facetsGet: vi.fn(),
}));

vi.mock("@/shared/lib/api", () => ({
  api: {
    media: { sources: { ":sourceId": { $get: (args: unknown) => apiMock.sourceGet(args) } } },
    library: {
      collections: { $get: (args: unknown) => apiMock.collectionsGet(args) },
      facets: { $get: () => apiMock.facetsGet() },
    },
  },
}));

const { defineLensSource, fetchCollectionsPage, fetchFacets, filtersToQuery } =
  await import("../lib/fetchers");
const { LibraryApiError } = await import("../lib/types");
const { EMPTY_FILTERS } = await import("../lib/types");

const PAGE: Page = { items: [], cursor: null, partial: false };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  apiMock.sourceGet.mockReset();
  apiMock.collectionsGet.mockReset();
  apiMock.facetsGet.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("defineLensSource", () => {
  // The lens-page hook reads through this descriptor; the cache key and the
  // request both derive from its sourceId + params, so a wrong sourceId or a
  // dropped filter axis would silently read the wrong list.
  it("targets the library-<lens> media source with firstPage cursor semantics", () => {
    const source = defineLensSource("az", EMPTY_FILTERS);
    expect(source.sourceId).toBe("library-az");
    expect(source.mode).toBe("infinite");
    // Bad/absent cursor must fall to page one (matches the server registration),
    // not 400 the route.
    expect(source.cursorOnNull).toBe("firstPage");
  });

  it("builds the per-lens id for each item lens", () => {
    expect(defineLensSource("timeline", EMPTY_FILTERS).sourceId).toBe("library-timeline");
    expect(defineLensSource("server", EMPTY_FILTERS).sourceId).toBe("library-server");
    expect(defineLensSource("quality", EMPTY_FILTERS).sourceId).toBe("library-quality");
  });

  it("threads the active filters (first value per axis) into the request and folds the cursor", async () => {
    apiMock.sourceGet.mockResolvedValueOnce({ ok: true, json: async () => PAGE });
    const source = defineLensSource("az", {
      ...EMPTY_FILTERS,
      kinds: ["movie"],
      genres: ["Drama", "Crime"],
      watched: ["partial"],
    });
    await source.fetchPage(source.params, "cursor-2");
    // The unified resolver collapses repeated params to one, so each axis is sent
    // as its FIRST selected value; the cursor rides as a query param.
    expect(apiMock.sourceGet).toHaveBeenCalledWith({
      param: { sourceId: "library-az" },
      query: { kinds: "movie", genres: "Drama", watched: "partial", cursor: "cursor-2" },
    });
  });

  it("omits the cursor on the first page", async () => {
    apiMock.sourceGet.mockResolvedValueOnce({ ok: true, json: async () => PAGE });
    const source = defineLensSource("timeline", EMPTY_FILTERS);
    await source.fetchPage(source.params, null);
    expect(apiMock.sourceGet).toHaveBeenCalledWith({
      param: { sourceId: "library-timeline" },
      query: {},
    });
  });
});

describe("filtersToQuery", () => {
  // Collections + facets ride their own routes (validated with c.req.queries()),
  // so they honor multi-value via repeated params — the encoding must keep arrays
  // and drop empty axes (an absent param is an open axis server-side).
  it("keeps multi-value axes as arrays and drops empty ones", () => {
    expect(
      filtersToQuery({
        ...EMPTY_FILTERS,
        kinds: ["movie", "tv"],
        genres: ["Drama"],
      }),
    ).toEqual({ kinds: ["movie", "tv"], genres: ["Drama"] });
  });

  it("returns a bare query for a fully open library", () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toEqual({});
  });
});

describe("fetchCollectionsPage", () => {
  it("requests /library/collections with the filter query and threads the cursor", async () => {
    const body = {
      collections: [{ id: "collection:10", title: "Saga", count: 3, preview: [] }],
      cursor: "next",
    };
    apiMock.collectionsGet.mockResolvedValueOnce(jsonResponse(body));
    const page = await fetchCollectionsPage({ ...EMPTY_FILTERS, servers: ["Plex"] }, "cur-1");
    expect(apiMock.collectionsGet).toHaveBeenCalledWith({
      query: { servers: ["Plex"], cursor: "cur-1" },
    });
    expect(page).toEqual(body);
  });

  it("omits the cursor on the first page", async () => {
    apiMock.collectionsGet.mockResolvedValueOnce(jsonResponse({ collections: [], cursor: null }));
    await fetchCollectionsPage(EMPTY_FILTERS, null);
    expect(apiMock.collectionsGet).toHaveBeenCalledWith({ query: {} });
  });

  it("wraps a non-OK response in a LibraryApiError carrying status + code", async () => {
    apiMock.collectionsGet.mockResolvedValueOnce(
      jsonResponse({ code: "library.bad_cursor", message: "nope" }, 400),
    );
    const err = await fetchCollectionsPage(EMPTY_FILTERS, "bad").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LibraryApiError);
    expect(err).toMatchObject({ status: 400, code: "library.bad_cursor" });
  });
});

describe("fetchFacets", () => {
  it("requests /library/facets and returns the parsed totals", async () => {
    const facets = {
      kinds: { movie: 2, tv: 1 },
      genres: { Drama: 3 },
      qualities: {},
      servers: {},
      watched: { watched: 0, partial: 1, unwatched: 2 },
      letters: ["A", "D"],
      decades: [2020, 1990],
    };
    apiMock.facetsGet.mockResolvedValueOnce(jsonResponse(facets));
    await expect(fetchFacets()).resolves.toEqual(facets);
    expect(apiMock.facetsGet).toHaveBeenCalledTimes(1);
  });

  it("wraps a non-OK response in a LibraryApiError", async () => {
    apiMock.facetsGet.mockResolvedValueOnce(jsonResponse({}, 503));
    const err = await fetchFacets().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LibraryApiError);
    expect((err as InstanceType<typeof LibraryApiError>).status).toBe(503);
  });
});
