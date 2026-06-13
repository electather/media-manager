import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { MediaType } from "@nama/shared/media";
import { MediaDetailModal, type MediaDetailItem } from "@/features/media-detail";
import { useHomeDetails } from "@/features/home/hooks/use-home-details";
import { splitCompositeId } from "@/shared/lib/media-id";
import { useAddToWatchlist, useIsInWatchlist, useRemoveFromWatchlist } from "../hooks";

type PeekSearch = { peek?: string };

/**
 * Shared modal driven by the `?peek=` search param. Reads the cached
 * watchlist row (when available) for an instant first paint and refines
 * with the full `useHomeDetails` payload as it arrives.
 */
// fallow-ignore-next-line complexity
export function WatchlistPeekModal() {
  const navigate = useNavigate();
  const { peek } = useSearch({ strict: false }) as PeekSearch;
  const peekParts = peek ? splitCompositeId(peek) : null;
  const detailsQuery = useHomeDetails(
    peekParts?.mediaId ?? null,
    (peekParts?.mediaType as MediaType | undefined) ?? null,
  );
  const peekItem = useMemo<MediaDetailItem | null>(() => {
    const fetched = detailsQuery.data;
    if (fetched) return { ...fetched.summary, ...fetched.details };
    return null;
  }, [detailsQuery.data]);
  const inWatchlist = useIsInWatchlist(peek ?? "");
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();
  const handleClose = useCallback(() => {
    void navigate({
      to: ".",
      search: (prev) => {
        const out = { ...(prev as Record<string, unknown>) };
        delete out.peek;
        return out;
      },
      replace: false,
      resetScroll: false,
    });
  }, [navigate]);
  const handleViewFullPage = useCallback(() => {
    if (!peek) return;
    const parts = splitCompositeId(peek);
    if (!parts) return;
    void navigate({ to: "/media/$mediaType/$mediaId", params: parts });
  }, [navigate, peek]);
  const handleToggleWatchlist = useCallback(() => {
    if (!peekItem) return;
    if (inWatchlist) {
      remove.mutate({ tmdbId: peekItem.tmdbId, mediaType: peekItem.mediaType });
    } else {
      add.mutate({
        request: {
          tmdbId: peekItem.tmdbId,
          mediaType: peekItem.mediaType,
          source: "manual",
        },
        seed: peekItem,
      });
    }
  }, [add, remove, inWatchlist, peekItem]);

  return (
    <MediaDetailModal
      item={peekItem}
      open={Boolean(peek)}
      onClose={handleClose}
      inWatchlist={inWatchlist}
      onToggleWatchlist={handleToggleWatchlist}
      onViewFullPage={handleViewFullPage}
    />
  );
}
