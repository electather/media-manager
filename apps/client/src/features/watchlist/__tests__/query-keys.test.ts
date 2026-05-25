import { describe, expect, it } from "vite-plus/test";
import { watchlistKeys } from "../lib/query-keys";

describe("watchlistKeys", () => {
  it("nests section endpoints under the section segment", () => {
    expect(watchlistKeys.tonight()).toEqual(["watchlist", "section", "tonight"]);
    expect(watchlistKeys.recently()).toEqual(["watchlist", "section", "recently"]);
  });
});
