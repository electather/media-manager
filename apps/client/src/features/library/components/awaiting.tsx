import { Server } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Card } from "@/features/home/components/card";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { Button } from "@/shared/ui/button";
import type { LibraryItem } from "../lib/types";

interface AwaitingProps {
  items: readonly LibraryItem[];
  onPeek: (id: string) => void;
  onRequestAll?: () => void;
}

export function Awaiting({ items, onPeek, onRequestAll }: AwaitingProps) {
  if (items.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>{m.library_awaiting_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle>
            {m.library_awaiting_title()}
            <SectionHeadCount value={items.length} />
          </SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <Button variant="ghost" size="sm" className="text-xs" onClick={onRequestAll}>
            <Server aria-hidden="true" className="size-3" />
            {m.library_awaiting_request_all()}
          </Button>
        </SectionHeadActions>
      </SectionHead>
      <div
        className="grid gap-x-4 gap-y-5 rounded-2xl border border-dashed border-input bg-card/40 p-5"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, color-mix(in oklab, var(--card) 88%, transparent) 0px, color-mix(in oklab, var(--card) 88%, transparent) 12px, color-mix(in oklab, var(--background) 92%, transparent) 12px, color-mix(in oklab, var(--background) 92%, transparent) 13px)",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
        }}
      >
        {items.map((it) => (
          <div key={it.id} className="opacity-90 transition-opacity hover:opacity-100">
            <Card item={it} rowKind="yourWatchlist" forceAspect="2/3" onClick={onPeek} />
          </div>
        ))}
      </div>
    </section>
  );
}
