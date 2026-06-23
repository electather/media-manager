import { useMemo } from "react";
import type { HostErrorCode } from "@nama/shared/diagnostics";
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
 * Resolves composite `mediaType:mediaId` via `home.getDetails`.
 * Home orchestrator owns metadata cold-fill so freshly-discovered titles resolve even if uncached.
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
  const detailsErrorCode = data?.error?.code ?? null;
  return { item, isLoading, isError, detailsErrorCode };
}
