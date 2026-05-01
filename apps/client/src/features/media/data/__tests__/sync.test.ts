import { describe, it, expect, beforeEach, vi, afterEach } from "vite-plus/test";
import type { CompactMediaItem, RowContentResponse } from "@ent-mcp/shared/home";
import type { MediaDetail } from "@ent-mcp/shared/media";

vi.mock("@/shared/lib/api", () => ({
  api: {
    media: {
      get: { $post: vi.fn() },
    },
  },
}));

vi.mock("@/shared/lib/db", () => {
  return {
    queryClient: {
      fetchQuery: vi.fn(),
      setQueryData: vi.fn(),
    },
  };
});

const mediaUtils = {
  writeInsert: vi.fn(),
  writeUpdate: vi.fn(),
};
const mediaStore = new Map<string, unknown>();
vi.mock("../media.collection", () => ({
  mediaCollection: {
    utils: mediaUtils,
    get: (id: string) => mediaStore.get(id),
  },
}));

const refUtils = {
  writeInsert: vi.fn(),
  writeUpdate: vi.fn(),
};
const refStore = new Map<string, unknown>();
vi.mock("../home-row-items.collection", async () => {
  const actual = await vi.importActual<typeof import("../home-row-items.collection")>(
    "../home-row-items.collection",
  );
  return {
    ...actual,
    homeRowItemsCollection: {
      utils: refUtils,
      get: (id: string) => refStore.get(id),
    },
  };
});

vi.mock("../home-layout.collection", () => ({
  homeLayoutCollection: {
    get: () => ({ rows: [{ rowId: "trendingNow", initialCursor: null }] }),
  },
  HOME_LAYOUT_QUERY_KEY: ["home", "layout"],
}));

const { splitRowContent, writeCompactToMedia, writeFullToMedia, ensureDetail, DETAIL_TTL_MS } =
  await import("../sync");
const { homeRowItemId } = await import("../home-row-items.collection");
const { queryClient } = await import("@/shared/lib/db");
const { api } = await import("@/shared/lib/api");

const mockedFetchQuery = queryClient.fetchQuery as unknown as ReturnType<typeof vi.fn>;
const mockedSetQueryData = queryClient.setQueryData as unknown as ReturnType<typeof vi.fn>;
const mockedMediaGet = api.media.get.$post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mediaStore.clear();
  refStore.clear();
  mediaUtils.writeInsert.mockReset();
  mediaUtils.writeUpdate.mockReset();
  refUtils.writeInsert.mockReset();
  refUtils.writeUpdate.mockReset();
  mockedFetchQuery.mockReset();
  mockedSetQueryData.mockReset();
  mockedMediaGet.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("writeCompactToMedia (V79)", () => {
  it("inserts a fresh compact row with _detailFetchedAt=null", () => {
    writeCompactToMedia({
      id: "movie:1",
      tmdbId: "1",
      mediaType: "movie",
      title: "Foo",
    } as CompactMediaItem);
    const inserted = mediaUtils.writeInsert.mock.calls[0]?.[0] as {
      _detailFetchedAt: number | null;
    };
    expect(inserted._detailFetchedAt).toBeNull();
  });

  it("preserves detail-only fields on existing full row when compact undefined", () => {
    mediaStore.set("movie:1", {
      id: "movie:1",
      tmdbId: "1",
      mediaType: "movie",
      title: "Foo",
      cast: ["A", "B"],
      _detailFetchedAt: 12345,
    });
    writeCompactToMedia({
      id: "movie:1",
      tmdbId: "1",
      mediaType: "movie",
      title: "Foo",
      poster: undefined,
    } as CompactMediaItem);
    const updated = mediaUtils.writeUpdate.mock.calls[0]?.[0] as MediaDetail & {
      _detailFetchedAt?: number;
    };
    expect(updated.cast).toEqual(["A", "B"]);
    expect(updated._detailFetchedAt).toBe(12345);
    expect("poster" in updated).toBe(false);
  });
});

describe("writeFullToMedia (V80)", () => {
  it("always stamps _detailFetchedAt with the current wall clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
    writeFullToMedia({
      id: "movie:1",
      tmdbId: "1",
      mediaType: "movie",
      title: "Foo",
    });
    const inserted = mediaUtils.writeInsert.mock.calls[0]?.[0] as { _detailFetchedAt: number };
    expect(inserted._detailFetchedAt).toBe(Date.UTC(2026, 4, 1));
  });
});

describe("splitRowContent (V86 / V18 / V89)", () => {
  it("writes media first, refs second, then advances cursor via setQueryData", () => {
    const calls: string[] = [];
    mediaUtils.writeInsert.mockImplementation(() => calls.push("media"));
    refUtils.writeInsert.mockImplementation(() => calls.push("ref"));
    const res: RowContentResponse = {
      items: [
        { id: "movie:1", tmdbId: "1", mediaType: "movie", title: "A" } as CompactMediaItem,
        { id: "movie:2", tmdbId: "2", mediaType: "movie", title: "B" } as CompactMediaItem,
      ],
      cursor: "next-cursor",
    };
    splitRowContent("trendingNow", null, res);
    expect(calls.indexOf("media")).toBeLessThan(calls.indexOf("ref"));
    expect(mockedSetQueryData).toHaveBeenCalledWith(["home", "layout"], expect.any(Function));
  });

  it("composite ref id includes cursor not page-number", () => {
    expect(homeRowItemId("trendingNow", null, 0)).toBe("trendingNow:first:0");
    expect(homeRowItemId("trendingNow", "abc", 4)).toBe("trendingNow:abc:4");
  });
});

describe("ensureDetail (V81 / V14 / V87)", () => {
  it("delegates to fetchQuery with media-detail key + TTL stale time", async () => {
    mockedFetchQuery.mockResolvedValue({
      id: "movie:1",
      tmdbId: "1",
      mediaType: "movie",
      title: "A",
    });
    await ensureDetail("movie:1");
    expect(mockedFetchQuery).toHaveBeenCalledTimes(1);
    const arg = mockedFetchQuery.mock.calls[0]?.[0] as {
      queryKey: unknown[];
      staleTime: number;
    };
    expect(arg.queryKey).toEqual(["media", "detail", "movie:1"]);
    expect(arg.staleTime).toBe(DETAIL_TTL_MS);
  });

  it("returns null without writing when detail RPC 404s", async () => {
    mockedFetchQuery.mockResolvedValue(null);
    const result = await ensureDetail("movie:99999");
    expect(result).toBeNull();
    expect(mediaUtils.writeInsert).not.toHaveBeenCalled();
    expect(mediaUtils.writeUpdate).not.toHaveBeenCalled();
  });
});
