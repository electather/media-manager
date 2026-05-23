import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Server } from "lucide-react";
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
import { VirtualGrid } from "@/shared/components/virtualized";
import { Button } from "@/shared/ui/button";
import { useAwaiting } from "../../hooks/use-awaiting";

export function Awaiting() {
  const { items } = useAwaiting();
  const navigate = useNavigate();
  const onPeek = useCallback(
    (id: string) => {
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, peek: id }),
        replace: false,
        resetScroll: false,
      });
    },
    [navigate],
  );
  if (items.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>{m.watchlist_awaiting_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle>
            {m.watchlist_awaiting_title()}
            <SectionHeadCount value={items.length} />
          </SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <Button variant="ghost" size="sm" className="text-xs">
            <Server aria-hidden="true" className="size-3" />
            {m.watchlist_awaiting_request_all()}
          </Button>
        </SectionHeadActions>
      </SectionHead>
      <VirtualGrid
        items={items}
        getKey={(it) => it.id}
        minColumnWidthPx={180}
        estimateRowHeight={() => 336}
        className="rounded-2xl border border-dashed border-input bg-card/40 p-5"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, color-mix(in oklab, var(--card) 88%, transparent) 0px, color-mix(in oklab, var(--card) 88%, transparent) 12px, color-mix(in oklab, var(--background) 92%, transparent) 12px, color-mix(in oklab, var(--background) 92%, transparent) 13px)",
        }}
        renderItem={(it) => (
          <div className="opacity-90 transition-opacity hover:opacity-100">
            <WatchlistCard item={it} forceAspect="2/3" onPeek={onPeek} />
          </div>
        )}
      />
    </section>
  );
}
