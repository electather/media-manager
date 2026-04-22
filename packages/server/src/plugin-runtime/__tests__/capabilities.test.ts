import { describe, it, expect } from "vite-plus/test";
import {
  CAPABILITY_CATALOG,
  capabilityKey,
  getCapability,
  MetadataV1,
  WatchHistoryV1,
  IdResolveV1,
} from "../capabilities";

describe("capability catalog", () => {
  it("keys by id@version", () => {
    expect(capabilityKey("metadata", "v1")).toBe("metadata@v1");
  });

  it("exposes every v1 capability", () => {
    const keys = Object.keys(CAPABILITY_CATALOG).sort();
    expect(keys).toEqual(
      [
        "calendar@v1",
        "idResolve@v1",
        "mediaRequest@v1",
        "metadata@v1",
        "ratings@v1",
        "recommendations@v1",
        "userComments@v1",
        "watchHistory@v1",
        "watchlist@v1",
      ].sort(),
    );
  });

  it("returns undefined for unknown versions", () => {
    expect(getCapability("metadata", "v99")).toBeUndefined();
  });
});

describe("MetadataV1 input validation", () => {
  it("rejects missing query on search", () => {
    const r = MetadataV1.methods.search.input.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts a valid discover filter", () => {
    const r = MetadataV1.methods.discover.input.safeParse({
      genres: ["28"],
      yearMin: 2020,
      limit: 20,
    });
    expect(r.success).toBe(true);
  });
});

describe("WatchHistoryV1 output validation", () => {
  it("requires watchedAt on history entries", () => {
    const r = WatchHistoryV1.methods.getHistory.output.safeParse([
      {
        item: {
          id: "movie:1",
          title: "x",
          year: 2020,
          type: "movie",
          rating: null,
          posterUrl: null,
        },
        // watchedAt missing
      },
    ]);
    expect(r.success).toBe(false);
  });
});

describe("IdResolveV1", () => {
  it("accepts partial output", () => {
    const r = IdResolveV1.methods.resolve.output.safeParse({ tmdb: "550" });
    expect(r.success).toBe(true);
  });
  it("accepts empty output", () => {
    const r = IdResolveV1.methods.resolve.output.safeParse({});
    expect(r.success).toBe(true);
  });
});
