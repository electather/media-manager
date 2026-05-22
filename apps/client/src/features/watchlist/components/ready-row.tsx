import { type CSSProperties } from "react";
import * as m from "@/paraglide/messages";
import { WatchlistCard } from "./watchlist-card";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import {
  ScrollRow,
  ScrollRowNextButton,
  ScrollRowPrevButton,
  ScrollRowTrack,
  ScrollRowViewport,
} from "@/shared/components/scroll-row";
import type { WatchlistItem } from "../lib/types";

interface ReadyRowProps {
  items: readonly WatchlistItem[];
  onPeek: (id: string) => void;
}

interface CardWidthVars extends CSSProperties {
  "--card-w": string;
  "--card-h": string;
}

const POSTER_VARS: CardWidthVars = { "--card-w": "200px", "--card-h": "300px" };

export function ReadyRow({ items, onPeek }: ReadyRowProps) {
  if (items.length === 0) return null;

  return (
    <ScrollRow revalidationKey={items.length} className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>{m.watchlist_ready_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle>
            {m.watchlist_ready_title()}
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
