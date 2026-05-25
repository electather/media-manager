import { describe, expect, it } from "vite-plus/test";
import { createMediaQueryKeys } from "../media-query-keys";

describe("createMediaQueryKeys", () => {
  it("uses the namespace as the root prefix", () => {
    const keys = createMediaQueryKeys("watchlist");
    expect(keys.all).toEqual(["watchlist"]);
    expect(keys.lists()).toEqual(["watchlist", "list"]);
    expect(keys.rows()).toEqual(["watchlist", "row"]);
  });

  it("nests list opts under the lists() parent so a root invalidate sweeps every variant", () => {
    const keys = createMediaQueryKeys("watchlist");
    const ready = keys.list({ filter: "ready" });
    const all = keys.list({});
    expect(ready).toEqual(["watchlist", "list", { filter: "ready" }]);
    expect(all).toEqual(["watchlist", "list", {}]);
    expect(ready.slice(0, 2)).toEqual(keys.lists());
    expect(all.slice(0, 2)).toEqual(keys.lists());
  });

  it("nests row(rowId, cursor) under rows() with the cursor in the tail for keyset pagination", () => {
    const keys = createMediaQueryKeys("home");
    expect(keys.row("trending-week", null)).toEqual(["home", "row", "trending-week", null]);
    expect(keys.row("trending-week", "cursor-abc")).toEqual([
      "home",
      "row",
      "trending-week",
      "cursor-abc",
    ]);
  });

  it("keeps namespaces distinct so home and watchlist caches do not collide", () => {
    const home = createMediaQueryKeys("home");
    const watchlist = createMediaQueryKeys("watchlist");
    expect(home.all).not.toEqual(watchlist.all);
    expect(home.list({})).not.toEqual(watchlist.list({}));
  });
});
