import * as m from "@/paraglide/messages";
import { ModalTVAirInfo } from "@/shared/components/media-detail-modal/modal-tv-air-info";
import type { MediaDetailItem } from "@/shared/components/media-detail-modal";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { DetailBreadcrumb } from "../detail-breadcrumb";
import { DetailSection } from "../detail-section";
import { UnpaddedModalSlot } from "./unpadded-modal-slot";

export function DetailOverviewSection({ item }: { item: HomeMediaItem }) {
  return (
    <DetailSection id="overview" title={m.media_detail_section_overview()}>
      <DetailBreadcrumb item={item} />
      {item.overview ? (
        <p className="m-0 max-w-180 text-pretty text-base leading-relaxed text-foreground/85">
          {item.overview}
        </p>
      ) : null}
      <UnpaddedModalSlot>
        <ModalTVAirInfo item={item as MediaDetailItem} />
      </UnpaddedModalSlot>
    </DetailSection>
  );
}
