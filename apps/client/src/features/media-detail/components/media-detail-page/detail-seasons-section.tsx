import * as m from "@/paraglide/messages";
import { ModalSeasons } from "@/shared/components/media-detail-modal/modal-seasons";
import type { MediaDetailItem } from "@/shared/components/media-detail-modal";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { DetailSection } from "../detail-section";
import { UnpaddedModalSlot } from "./unpadded-modal-slot";

export function DetailSeasonsSection({ item }: { item: HomeMediaItem }) {
  if ((item.seasons?.length ?? 0) === 0) return null;
  return (
    <DetailSection id="seasons" title={m.media_detail_section_seasons()}>
      <UnpaddedModalSlot>
        <ModalSeasons item={item as MediaDetailItem} />
      </UnpaddedModalSlot>
    </DetailSection>
  );
}
