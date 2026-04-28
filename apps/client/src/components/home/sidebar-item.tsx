import type { MouseEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { formatRelativeAirDate } from "@/lib/relative-date";
import { useArtworkIfMissing } from "@/hooks/use-artwork";

export function SidebarItem({ item }: { item: CompactMediaItem }) {
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
    event.preventDefault();
    void router.navigate({
      to: ".",
      search: (prev) => ({ ...(prev as Record<string, unknown>), peek: item.id }),
      replace: false,
    });
  }

  const episodeLine = item.episode ? `S${item.episode.season} E${item.episode.episode}` : null;
  const dateLine = item.episode ? formatRelativeAirDate(item.episode.airsAt) : null;
  // Sidebar is always above the fold — fetch eagerly, never gate on viewport.
  const artwork = useArtworkIfMissing(
    {
      key: item.id,
      ids: { tmdb: item.tmdbId },
      type: item.mediaType,
      poster: item.poster,
      backdrop: item.backdrop,
      clearLogo: item.clearLogo,
    },
    ["poster"],
    { enabled: true },
  );
  const art =
    artwork.data?.backdrop[0]?.url ?? item.backdrop ?? artwork.data?.poster[0]?.url ?? item.poster;

  return (
    <a
      href={`/media/${item.id}`}
      onClick={handleClick}
      data-testid="sidebar-item"
      className="flex items-center gap-3 rounded-md p-1 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="aspect-video w-[88px] shrink-0 overflow-hidden rounded-md bg-muted/40 sm:w-[100px] xl:w-[110px]">
        {art ? (
          <img
            src={art}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium leading-tight text-foreground">
          {item.title}
        </span>
        {episodeLine ? (
          <span className="text-[11px] text-muted-foreground">{episodeLine}</span>
        ) : null}
        {dateLine ? <span className="text-[11px] text-amber-300/90">{dateLine}</span> : null}
      </div>
    </a>
  );
}
