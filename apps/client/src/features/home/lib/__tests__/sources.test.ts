import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Page } from "@nama/shared/media";
import { homeRowSource } from "../sources";

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

const PAGE: Page = { items: [], cursor: null, partial: false };

function mockFetch() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(PAGE), { status: 200 }));
}

function requestedUrl(spy: ReturnType<typeof mockFetch>): string {
  const input = spy.mock.calls[0]![0];
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

describe("homeRowSource", () => {
  it("maps the row stub straight onto a media source descriptor", () => {
    const source = homeRowSource("trendingNow", null);
    expect(source.sourceId).toBe("trendingNow");
    expect(source.params).toEqual({});
    expect(source.mode).toBe("infinite");
    // Mirrors the server registration's `"400"` policy (V.CU1): a bad cursor
    // is rejected, not reset to page one.
    expect(source.cursorOnNull).toBe("throw");
    expect(source.initialCursor).toBeNull();
  });

  it("threads the server-minted seed cursor as the initial cursor", () => {
    const source = homeRowSource("becauseYouWatched", "seed-cursor");
    expect(source.initialCursor).toBe("seed-cursor");
  });

  it("fetches the shared resolver endpoint for the row's sourceId", async () => {
    const spy = mockFetch();
    const source = homeRowSource("trendingNow", null);
    await source.fetchPage(source.params, null);
    expect(requestedUrl(spy)).toContain("/api/media/sources/trendingNow");
  });

  it("threads the cursor as the `cursor` query param", async () => {
    const spy = mockFetch();
    const source = homeRowSource("becauseYouWatched", null);
    await source.fetchPage(source.params, "page2");
    expect(requestedUrl(spy)).toContain("cursor=page2");
  });
});
