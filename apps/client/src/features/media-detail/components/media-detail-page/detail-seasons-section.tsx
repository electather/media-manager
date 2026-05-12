import * as m from "@/paraglide/messages";
import { ModalSeasons } from "@/shared/components/media-detail-modal/modal-seasons";
import type { MediaDetailItem } from "@/shared/components/media-detail-modal";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { DetailSection } from "../detail-section";
import { UnpaddedModalSlot } from "./unpadded-modal-slot";

export function DetailSeasonsSection({
  item,
  hasSeason,
}: {
  item: HomeMediaItem;
  hasSeason: boolean;
}) {
  if (!hasSeason) return null;
  return (
    <DetailSection id="seasons" title={m.media_detail_section_seasons()}>
      <UnpaddedModalSlot>
        <ModalSeasons item={item as MediaDetailItem} />
      </UnpaddedModalSlot>
    </DetailSection>
  );
}
