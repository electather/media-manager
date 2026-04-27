import type { MouseEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import type { LayoutHero } from "@ent-mcp/shared/home";
import { useArtwork } from "@/hooks/use-artwork";

export function Hero({ hero }: { hero: LayoutHero }) {
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
    if (hero.source === "continueWatching" && hero.resumeUrl != null) {
      // Anchor's native href targets the resume URL with target=_blank — let it through.
      return;
    }
    event.preventDefault();
    void router.navigate({
      to: ".",
      search: (prev) => ({ ...(prev as Record<string, unknown>), peek: hero.item.id }),
      replace: false,
    });
  }

  const isResumable = hero.source === "continueWatching" && hero.resumeUrl != null;
  const item = hero.item;
  const progress = item.progress;
  const remaining = progress ? Math.max(progress.total - progress.watched, 0) : null;
  const percent = progress && progress.total > 0 ? (progress.watched / progress.total) * 100 : 0;

  // Per V47: prefer the canonical URLs already inlined on the wire item.
  // Hero is always above the fold, so the only gate is whether we still
  // need anything — fetch only when an inline field that hero renders is
  // missing.
  const needsArtwork = item.backdrop == null || item.clearLogo == null;
  const artwork = useArtwork(
    {
      key: item.id,
      ids: { tmdb: item.tmdbId },
      type: item.mediaType,
    },
    { enabled: needsArtwork },
  );
  const backdropUrl =
    item.backdrop ?? item.poster ?? artwork.data?.backdrop[0]?.url ?? artwork.data?.poster[0]?.url;
  const clearLogoUrl = item.clearLogo ?? artwork.data?.clearLogo[0]?.url;

  return (
    <a
      href={isResumable ? hero.resumeUrl! : `/media/${item.id}`}
      target={isResumable ? "_blank" : undefined}
      rel={isResumable ? "noreferrer" : undefined}
      onClick={handleClick}
      data-testid="home-hero"
      className="group/hero flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-md bg-muted/40">
        {backdropUrl ? (
          <img
            src={backdropUrl}
            alt=""
            loading="eager"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : null}
        {clearLogoUrl ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-[6%]">
            <img
              src={clearLogoUrl}
              alt={item.title}
              className="max-h-[55%] max-w-[70%] object-contain drop-shadow-[0_4px_12px_rgba(0,0,0,0.6)]"
            />
          </div>
        ) : null}
        {progress ? (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/15" aria-hidden>
            <div className="h-full bg-progress-watched" style={{ width: `${percent}%` }} />
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span>
          {remaining !== null
            ? remaining < 60
              ? `${Math.round(remaining)}min left`
              : `${Math.floor(remaining / 60)}h ${Math.round(remaining % 60)}min left`
            : item.title}
        </span>
        {item.episodeProgress ? (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden>▦</span>
            {item.episodeProgress.watched}/{item.episodeProgress.total} watched
          </span>
        ) : null}
      </div>
    </a>
  );
}
