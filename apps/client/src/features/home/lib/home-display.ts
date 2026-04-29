import { z } from "zod";
import type { RowKind } from "@ent-mcp/shared/home";

export const PEEK_ID_REGEX = /^(movie|tv):\d+$/;

export const peekSchema = z.object({
  peek: z.string().regex(PEEK_ID_REGEX).optional(),
});

export type PeekSearch = z.infer<typeof peekSchema>;

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
