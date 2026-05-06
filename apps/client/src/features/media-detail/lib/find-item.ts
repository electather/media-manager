import { useMemo } from "react";
import { useHomeDetails } from "@/features/home/hooks/use-home-details";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { splitCompositeId } from "@/shared/lib/media-id";

export interface FindMediaItemResult {
  item: HomeMediaItem | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * React hook that resolves a composite `mediaType:mediaId` to a `HomeMediaItem`
 * via `home.getDetails`. Returns `null` while the query is pending or when the
 * id is malformed; the detail page renders a skeleton until both
 * `summary` + `details` arrive.
 *
 * Replaces the mock-feed lookup that shipped with the prototype: the home
 * orchestrator owns metadata cold-fill so a freshly-discovered title resolves
 * here even when no row has cached it.
 */
// fallow-ignore-next-line complexity
export function useMediaItem(compositeId: string): FindMediaItemResult {
  const parts = useMemo(() => splitCompositeId(compositeId), [compositeId]);
  const { data, isLoading, isError } = useHomeDetails(
    parts?.mediaId ?? null,
    (parts?.mediaType as "movie" | "tv" | undefined) ?? null,
  );
  const item = useMemo<HomeMediaItem | null>(() => {
    if (!data) return null;
    return { ...data.summary, ...data.details };
  }, [data]);
  return { item, isLoading, isError };
}
