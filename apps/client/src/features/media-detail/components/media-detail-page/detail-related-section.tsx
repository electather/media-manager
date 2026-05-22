import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import { splitCompositeId } from "@/shared/lib/media-id";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { DetailRelatedRow } from "../detail-related-row";
import { DetailSection } from "../detail-section";

type Props = {
  item: HomeMediaItem;
  onWatchlistToggle: (item: HomeMediaItem) => void;
};

export function DetailRelatedSection({ item, onWatchlistToggle }: Props) {
  const navigate = useNavigate();
  const handleRelatedClick = useCallback(
    (id: string) => {
      const parts = splitCompositeId(id);
      if (!parts) return;
      void navigate({
        to: "/media/$mediaType/$mediaId",
        params: parts,
      });
    },
    [navigate],
  );

  return (
    <DetailSection id="related" title={m.media_detail_section_related()}>
      <DetailRelatedRow
        item={item}
        onWatchlistToggle={onWatchlistToggle}
        onCardClick={handleRelatedClick}
      />
    </DetailSection>
  );
}
