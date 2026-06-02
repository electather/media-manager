import { describe, expect, it } from "vite-plus/test";
import { filtersToSearch, librarySearchSchema, searchToFilters } from "../lib/search";
import { EMPTY_FILTERS, type LibraryFilters } from "../lib/types";

describe("library search params", () => {
  // An empty axis must NOT appear in the URL, otherwise a fully-open library
  // would carry `?kinds=&genres=…` and `/library` would never stay bare.
  it("omits empty axes when serializing to the URL", () => {
    expect(filtersToSearch(EMPTY_FILTERS)).toEqual({
      kinds: undefined,
      genres: undefined,
      qualities: undefined,
      servers: undefined,
      watched: undefined,
    });
  });

  it("keeps only the populated axes", () => {
    const search = filtersToSearch({ ...EMPTY_FILTERS, kinds: ["tv"], watched: ["watched"] });
    expect(search.kinds).toEqual(["tv"]);
    expect(search.watched).toEqual(["watched"]);
    expect(search.genres).toBeUndefined();
    expect(search.servers).toBeUndefined();
  });

  it("treats missing params as an open axis when hydrating", () => {
    expect(searchToFilters({})).toEqual(EMPTY_FILTERS);
    expect(searchToFilters({ genres: ["Drama"] }).genres).toEqual(["Drama"]);
  });

  // Round-trip must be lossless so a shared/bookmarked link restores the exact
  // same filtered view the author saw.
  it("round-trips filters through the URL without loss", () => {
    const filters: LibraryFilters = {
      kinds: ["movie"],
      genres: ["Crime", "Drama"],
      qualities: ["4K HDR"],
      servers: ["Plex"],
      watched: ["partial"],
    };
    expect(searchToFilters(filtersToSearch(filters))).toEqual(filters);
  });
});

describe("librarySearchSchema", () => {
  // A hand-typed or legacy link sends a single `?kinds=movie` (a string, not an
  // array). Without coercion the route would throw a SearchParamError and the
  // whole library would drop into its error boundary instead of just showing
  // the title.
  it("coerces a single value into a one-element array", () => {
    expect(librarySearchSchema.parse({ kinds: "movie" }).kinds).toEqual(["movie"]);
    expect(librarySearchSchema.parse({ genres: "Drama" }).genres).toEqual(["Drama"]);
  });

  it("passes a well-formed array through untouched", () => {
    expect(librarySearchSchema.parse({ kinds: ["movie", "tv"] }).kinds).toEqual(["movie", "tv"]);
  });

  // A bogus value degrades to an open axis rather than erroring the route.
  it("drops values that fail validation instead of throwing", () => {
    expect(librarySearchSchema.parse({ kinds: "totally-not-a-kind" }).kinds).toBeUndefined();
    expect(librarySearchSchema.parse({ watched: ["nope"] }).watched).toBeUndefined();
  });

  it("leaves absent axes undefined", () => {
    expect(librarySearchSchema.parse({})).toEqual({
      kinds: undefined,
      genres: undefined,
      qualities: undefined,
      servers: undefined,
      watched: undefined,
    });
  });
});
