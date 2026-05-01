import type { RowKind } from "@ent-mcp/shared/home";

export interface RowDisplayConfig {
  slot: "main" | "sidebar";
  aspectRatio: "poster" | "backdrop";
  showMatchReasonInline: boolean;
}

export const ROW_DISPLAY: Record<RowKind, RowDisplayConfig> = {
  continueWatching: { slot: "main", aspectRatio: "backdrop", showMatchReasonInline: false },
  upcomingForYou: { slot: "sidebar", aspectRatio: "backdrop", showMatchReasonInline: false },
  recommendedForYou: { slot: "main", aspectRatio: "poster", showMatchReasonInline: true },
  becauseYouWatched: { slot: "main", aspectRatio: "poster", showMatchReasonInline: false },
  trendingNow: { slot: "main", aspectRatio: "poster", showMatchReasonInline: false },
  newReleases: { slot: "main", aspectRatio: "poster", showMatchReasonInline: false },
  yourWatchlist: { slot: "main", aspectRatio: "poster", showMatchReasonInline: false },
};
