import { Server } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Card } from "@/features/home/components/card";
import type { WatchlistItem } from "../lib/types";
import { SectionHead } from "./section-head";

interface AwaitingProps {
  items: readonly WatchlistItem[];
  onPeek: (id: string) => void;
  onRequestAll: () => void;
}

/**
 * Diagonal-striped grid for items that are saved but not yet on a server.
 * Inline `repeating-linear-gradient` mirrors the prototype's "needs request"
 * texture using token-driven colors so it tracks dark / light themes.
 */
export function Awaiting({ items, onPeek, onRequestAll }: AwaitingProps) {
  if (items.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead
        eyebrow={m.watchlist_section_awaiting_eyebrow()}
        title={m.watchlist_section_awaiting_title()}
        count={items.length}
        accessory={
          <Button type="button" variant="outline" size="sm" onClick={onRequestAll}>
            <Server aria-hidden="true" className="size-3" />
            {m.watchlist_request_all()}
          </Button>
        }
      />
      <div
        className="grid gap-5 rounded-xl border border-dashed border-border p-5 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, color-mix(in oklab, var(--border) 60%, transparent) 0 1px, transparent 1px 12px)",
        }}
      >
        {items.map((it) => (
          <div
            key={it.id}
            className="opacity-85 transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100"
          >
            <Card item={it} rowKind="yourWatchlist" forceAspect="2/3" onClick={onPeek} />
          </div>
        ))}
      </div>
    </section>
  );
}
