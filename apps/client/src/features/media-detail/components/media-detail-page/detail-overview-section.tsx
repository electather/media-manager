import { AlertTriangle } from "lucide-react";
import type { HostErrorCode } from "@nama/shared/diagnostics";
import * as m from "@/paraglide/messages";
import { ModalTVAirInfo } from "../media-detail-modal/modal-tv-air-info";
import type { MediaDetailItem } from "../media-detail-modal";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { DetailBreadcrumb } from "../detail-breadcrumb";
import { DetailSection } from "../detail-section";
import { UnpaddedModalSlot } from "./unpadded-modal-slot";

export function DetailOverviewSection({
  item,
  detailsErrorCode,
}: {
  item: HomeMediaItem;
  detailsErrorCode: HostErrorCode | null;
}) {
  return (
    <DetailSection id="overview" title={m.media_detail_section_overview()}>
      <DetailBreadcrumb item={item} />
      {detailsErrorCode ? <DetailsFallbackNotice code={detailsErrorCode} /> : null}
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

function DetailsFallbackNotice({ code }: { code: HostErrorCode }) {
  return (
    <div
      role="status"
      className="flex max-w-180 gap-3 rounded-md border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-foreground shadow-[0_1px_0_0_oklch(1_0_0/0.04)]"
    >
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-amber-300"
        strokeWidth={2.2}
      />
      <div className="min-w-0 space-y-1">
        <p className="m-0 font-medium">{m.media_detail_partial_details_title()}</p>
        <p className="m-0 text-foreground/75">{m.media_detail_partial_details_body()}</p>
        <p className="m-0 font-mono text-xs text-foreground/55">
          {m.media_detail_partial_details_code({ code })}
        </p>
      </div>
    </div>
  );
}
