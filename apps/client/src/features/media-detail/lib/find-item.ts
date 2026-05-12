import { useMemo } from "react";
import type { HostErrorCode } from "@ent-mcp/shared/diagnostics";
import { useHomeDetails } from "@/features/home/hooks/use-home-details";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { splitCompositeId } from "@/shared/lib/media-id";

export interface FindMediaItemResult {
  item: HomeMediaItem | null;
  isLoading: boolean;
  isError: boolean;
  detailsErrorCode: HostErrorCode | null;
}

/**
 * React hook that resolves a composite `mediaType:mediaId` to a `HomeMediaItem`
 * via `home.getDetails`. Returns `null` while the query is pending or when the
 * id is malformed; when the details provider fails, the summary still renders
 * and `detailsErrorCode` carries the fallback reason for localized copy.
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
  const detailsErrorCode = data?.details === null ? (data.error?.code ?? null) : null;
  return { item, isLoading, isError, detailsErrorCode };
}
