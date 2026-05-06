import type { HomeMediaItem } from "@/features/home/lib/types";

type Props = {
  item: HomeMediaItem;
};

export function DetailHeroPoster({ item }: Props) {
  const src = item.poster ?? item.backdrop;

  return (
    <div className="relative aspect-[2/3] w-35 shrink-0 overflow-hidden rounded-xl border border-border bg-muted shadow-[0_24px_60px_oklch(0_0_0/0.55)] sm:w-44 lg:w-55">
      {src ? <img src={src} alt={item.title} className="size-full object-cover" /> : null}
    </div>
  );
}
