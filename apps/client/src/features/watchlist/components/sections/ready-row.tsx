import * as m from "@/paraglide/messages";
import { WatchlistCard } from "../watchlist-card";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import {
  POSTER_VARS,
  ScrollRow,
  ScrollRowNextButton,
  ScrollRowPrevButton,
  ScrollRowTrack,
  ScrollRowViewport,
} from "@/shared/components/scroll-row";
import { useReadyRow } from "../../hooks/use-ready-row";
import { useWatchlistPeek } from "../../hooks/use-watchlist-peek";

export function ReadyRow() {
  const { items } = useReadyRow();
  const onPeek = useWatchlistPeek();
  if (items.length === 0) return null;

  return (
    <ScrollRow revalidationKey={items.length} className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>
            {m.watchlist_section_eyebrow({ section: "ready" })}
          </SectionHeadEyebrow>
          <SectionHeadTitle>
            {m.watchlist_section_title({ section: "ready" })}
            <SectionHeadCount value={items.length} />
          </SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <ScrollRowPrevButton aria-label={m.watchlist_ready_scroll_prev()} />
          <ScrollRowNextButton aria-label={m.watchlist_ready_scroll_next()} />
        </SectionHeadActions>
      </SectionHead>
      <ScrollRowViewport style={POSTER_VARS}>
        <ScrollRowTrack
          virtualize
          className="pb-1"
          items={items}
          getKey={(it) => it.id}
          estimateItemWidth={200}
          renderItem={(it) => <WatchlistCard item={it} forceAspect="2/3" onPeek={onPeek} />}
        />
      </ScrollRowViewport>
    </ScrollRow>
  );
}
