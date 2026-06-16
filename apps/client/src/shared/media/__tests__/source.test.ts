import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { Page } from "@nama/shared/media";

const $get = vi.fn();

vi.mock("@/shared/lib/api", () => ({
  api: { media: { sources: { ":sourceId": { $get } } } },
}));

const { defineMediaSource } = await import("../source");
const { MediaApiError } = await import("../error");

const PAGE: Page = { items: [], cursor: null, partial: false };

afterEach(() => {
  vi.clearAllMocks();
});

describe("defineMediaSource fetchPage", () => {
  it("binds the one resolver endpoint, serializing params and dropping null/undefined", async () => {
    $get.mockResolvedValueOnce({ ok: true, json: async () => PAGE });
    const source = defineMediaSource<{
      sort: string;
      bucket?: string;
      mood?: string;
      limit: number;
    }>({
      sourceId: "watchlist-items",
      params: { sort: "alpha", bucket: "ready", limit: 60 },
      mode: "infinite",
      cursorOnNull: "firstPage",
    });
    const page = await source.fetchPage(source.params, "cur-1");
    expect(page).toBe(PAGE);
    expect($get).toHaveBeenCalledWith({
      param: { sourceId: "watchlist-items" },
      query: { sort: "alpha", bucket: "ready", limit: "60", cursor: "cur-1" },
    });
  });

  it("forwards a string[] param as-is (repeated params) and drops an empty array", async () => {
    // The library lens filters arrive as `string[]` axes; a non-empty one must
    // ride to the resolver as repeated params (`?genres=Drama&genres=Crime`),
    // while an empty axis is dropped like an unset param.
    $get.mockResolvedValueOnce({ ok: true, json: async () => PAGE });
    const source = defineMediaSource<{ genres: string[]; servers: string[]; limit: number }>({
      sourceId: "library-az",
      params: { genres: ["Drama", "Crime"], servers: [], limit: 60 },
      mode: "infinite",
      cursorOnNull: "firstPage",
    });
    await source.fetchPage(source.params, null);
    expect($get).toHaveBeenCalledWith({
      param: { sourceId: "library-az" },
      query: { genres: ["Drama", "Crime"], limit: "60" },
    });
  });

  it("omits the cursor query key on the first page", async () => {
    $get.mockResolvedValueOnce({ ok: true, json: async () => PAGE });
    const source = defineMediaSource<{ limit: number }>({
      sourceId: "watchlist-recently",
      params: { limit: 5 },
      mode: "section",
      cursorOnNull: "firstPage",
    });
    await source.fetchPage(source.params, null);
    expect($get).toHaveBeenCalledWith({
      param: { sourceId: "watchlist-recently" },
      query: { limit: "5" },
    });
  });

  it("throws a MediaApiError carrying status and code on a non-OK response", async () => {
    $get.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ code: "media.source_unknown", message: "nope" }),
    });
    const source = defineMediaSource<Record<string, never>>({
      sourceId: "similarTo",
      params: {},
      mode: "infinite",
      cursorOnNull: "throw",
    });
    await expect(source.fetchPage(source.params, null)).rejects.toBeInstanceOf(MediaApiError);
    $get.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ code: "media.source_unknown", message: "nope" }),
    });
    const err = await source.fetchPage(source.params, null).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 404, code: "media.source_unknown" });
  });
});
