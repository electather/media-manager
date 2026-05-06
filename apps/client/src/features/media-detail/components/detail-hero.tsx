import { Sparkles } from "lucide-react";
import { MATCH_REASON_COPY } from "@/features/home/lib/home-feed-config";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { DetailHeroActions } from "./detail-hero-actions";
import { DetailHeroBackdrop } from "./detail-hero-backdrop";
import { DetailHeroPoster } from "./detail-hero-poster";
import { DetailMetaLine } from "./detail-meta-line";

type Props = {
  item: HomeMediaItem;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
};

function HeroTitle({ item }: { item: HomeMediaItem }) {
  if (item.clearLogo) {
    return (
      <img
        src={item.clearLogo}
        alt={item.title}
        loading="eager"
        decoding="async"
        className="w-auto max-w-[70%] object-contain object-left drop-shadow-[0_2px_24px_oklch(0_0_0/0.55)] [max-height:clamp(56px,8vw,128px)]"
      />
    );
  }
  if (item.clearLogoText) {
    return (
      <div
        aria-label={item.title}
        className="overflow-hidden text-ellipsis whitespace-nowrap font-mono font-bold leading-none tracking-[0.18em] text-foreground drop-shadow-[0_2px_24px_oklch(0_0_0/0.55)] [font-size:clamp(28px,4.6vw,64px)]"
      >
        {item.clearLogoText}
      </div>
    );
  }
  return (
    <h1 className="m-0 text-balance font-heading font-semibold leading-[1.05] tracking-[-0.02em] text-foreground drop-shadow-[0_2px_24px_oklch(0_0_0/0.55)] [font-size:clamp(32px,4.6vw,64px)]">
      {item.title}
    </h1>
  );
}

function HeroMatchReason({ item }: { item: HomeMediaItem }) {
  const reason = item.matchReason;
  if (!reason) return null;
  const text = MATCH_REASON_COPY[reason.key](reason.params ?? {});
  return (
    <div className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.06em] text-primary">
      <Sparkles aria-hidden="true" className="size-3" />
      <span>{text}</span>
    </div>
  );
}

function HeroTags({ tags }: { tags: string[] | undefined }) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded border border-foreground/15 bg-black/35 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-foreground/75 backdrop-blur-md"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

export function DetailHero({ item, inWatchlist, onToggleWatchlist }: Props) {
  return (
    <section className="relative flex min-h-[min(720px,78vh)] items-end px-6 pb-10 pt-30 sm:px-8">
      <DetailHeroBackdrop src={item.backdrop} />
      <div className="mx-auto w-full max-w-[1600px]">
        <div className="grid items-end gap-6 sm:grid-cols-[140px_1fr] sm:gap-8 lg:grid-cols-[220px_1fr]">
          <DetailHeroPoster item={item} />
          <div className="flex min-w-0 flex-col gap-4 sm:gap-4.5">
            <HeroMatchReason item={item} />
            <HeroTitle item={item} />
            <DetailMetaLine item={item} />
            <DetailHeroActions
              item={item}
              inWatchlist={inWatchlist}
              onToggleWatchlist={onToggleWatchlist}
            />
            <HeroTags tags={item.tags} />
          </div>
        </div>
      </div>
    </section>
  );
}
