export { useCounts } from "./use-counts";
export { useTonight } from "./use-tonight";
export { useRecentlyAdded } from "./use-recently-added";
export { useMoods } from "./use-moods";
export { useMoodCluster } from "./use-mood-cluster";
export { useAllItems, type UseAllItemsArgs } from "./use-all-items";
export { useReadyRow } from "./use-ready-row";
export { useComingUp } from "./use-coming-up";
export { useAwaiting } from "./use-awaiting";
// Membership + mutation hooks now live in the shared media layer (design §B3).
// The feature barrel re-exports them so cross-feature consumers (home cards,
// media-detail, search rows) keep their `@/features/watchlist` import.
export { useIsInWatchlist, useWatchlistIdSet } from "@/shared/media/use-watchlist-membership";
export {
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useToggleWatchlist,
} from "@/shared/media/use-watchlist-mutations";
