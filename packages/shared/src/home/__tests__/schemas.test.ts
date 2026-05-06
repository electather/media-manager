import { describe, expect, it } from "vite-plus/test";
import {
  homeGetDetailsInputSchema,
  homeGetLayoutInputSchema,
  homeGetRowContentInputSchema,
  homeGetSeasonAvailabilityInputSchema,
} from "../schemas";

describe("home schemas — homeGetLayoutInputSchema", () => {
  it("accepts an empty object", () => {
    expect(homeGetLayoutInputSchema.safeParse({}).success).toBe(true);
  });

  it("rejects extra keys", () => {
    expect(homeGetLayoutInputSchema.safeParse({ foo: 1 }).success).toBe(false);
  });
});

describe("home schemas — homeGetRowContentInputSchema", () => {
  it("accepts an arbitrary slug rowId with null cursor", () => {
    const parsed = homeGetRowContentInputSchema.parse({
      rowId: "recommendedForYou-tv",
      cursor: null,
    });
    expect(parsed.rowId).toBe("recommendedForYou-tv");
    expect(parsed.cursor).toBeNull();
  });

  it("accepts a non-null opaque cursor", () => {
    const parsed = homeGetRowContentInputSchema.parse({
      rowId: "trendingNow",
      cursor: "eyJvZmZzZXQiOjEyfQ",
    });
    expect(parsed.cursor).toBe("eyJvZmZzZXQiOjEyfQ");
  });

  it("rejects empty rowId", () => {
    expect(homeGetRowContentInputSchema.safeParse({ rowId: "", cursor: null }).success).toBe(false);
  });

  it("rejects missing cursor field", () => {
    expect(homeGetRowContentInputSchema.safeParse({ rowId: "trendingNow" }).success).toBe(false);
  });

  it("rejects extra keys", () => {
    expect(
      homeGetRowContentInputSchema.safeParse({ rowId: "trendingNow", cursor: null, extra: 1 })
        .success,
    ).toBe(false);
  });
});

describe("home schemas — homeGetDetailsInputSchema", () => {
  it("accepts movie + tv media types", () => {
    expect(homeGetDetailsInputSchema.parse({ tmdbId: "550", mediaType: "movie" }).mediaType).toBe(
      "movie",
    );
    expect(homeGetDetailsInputSchema.parse({ tmdbId: "1396", mediaType: "tv" }).mediaType).toBe(
      "tv",
    );
  });

  it("rejects unknown media types", () => {
    expect(homeGetDetailsInputSchema.safeParse({ tmdbId: "1", mediaType: "anime" }).success).toBe(
      false,
    );
  });

  it("rejects empty tmdbId", () => {
    expect(homeGetDetailsInputSchema.safeParse({ tmdbId: "", mediaType: "movie" }).success).toBe(
      false,
    );
  });

  it("rejects extra keys", () => {
    expect(
      homeGetDetailsInputSchema.safeParse({ tmdbId: "1", mediaType: "movie", x: 1 }).success,
    ).toBe(false);
  });
});

describe("home schemas — homeGetSeasonAvailabilityInputSchema", () => {
  it("accepts a non-empty tmdbId", () => {
    expect(homeGetSeasonAvailabilityInputSchema.parse({ tmdbId: "1396" }).tmdbId).toBe("1396");
  });

  it("rejects empty tmdbId", () => {
    expect(homeGetSeasonAvailabilityInputSchema.safeParse({ tmdbId: "" }).success).toBe(false);
  });

  it("rejects extra keys", () => {
    expect(
      homeGetSeasonAvailabilityInputSchema.safeParse({ tmdbId: "1396", extra: 1 }).success,
    ).toBe(false);
  });
});
