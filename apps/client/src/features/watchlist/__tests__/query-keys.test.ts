import { describe, expect, it } from "vite-plus/test";
import { mediaKeys } from "@/shared/media/query-keys";
import { DEFAULT_WATCHLIST_ITEMS_PARAMS } from "@/shared/media/use-watchlist-mutations";
import { watchlistKeys } from "../lib/query-keys";

describe("watchlistKeys", () => {
  it("derives every section key from the shared mediaKeys root (V.CL1)", () => {
    expect(watchlistKeys.root).toEqual(mediaKeys.root);
    expect(watchlistKeys.tonight()).toEqual(mediaKeys.source("watchlist-tonight", {}));
    expect(watchlistKeys.recently()).toEqual(mediaKeys.source("watchlist-recently", {}));
    expect(watchlistKeys.moodItems("cozy")).toEqual(
      mediaKeys.source("watchlist-mood-items", { moodId: "cozy" }),
    );
    expect(watchlistKeys.counts()).toEqual(mediaKeys.counts());
    expect(watchlistKeys.moods()).toEqual(mediaKeys.moods());
  });

  it("default items key matches the shared optimistic-insert key (#505 coupling)", () => {
    // The optimistic add/remove write through this exact cache, so the
    // unfiltered all-items list must register with matching params.
    expect(watchlistKeys.items()).toEqual(
      mediaKeys.source("watchlist-items", DEFAULT_WATCHLIST_ITEMS_PARAMS),
    );
  });

  it("folds sort / bucket / mood into the items key", () => {
    expect(watchlistKeys.items({ sort: "alpha", bucket: "ready", mood: "cozy" })).toEqual(
      mediaKeys.source("watchlist-items", { sort: "alpha", bucket: "ready", mood: "cozy" }),
    );
  });
});
