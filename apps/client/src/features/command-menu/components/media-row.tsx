import { Film, Tv } from "lucide-react";
import { compact, take } from "es-toolkit/array";

import { m } from "@/paraglide/messages";
import { CommandItem } from "@/shared/ui/command";

import { mediaMatchValue } from "../lib/match-values";
import type { MediaItem } from "../types";
import { RowAffordance, RowContent } from "./command-row";

function mediaGenresLabel(item: MediaItem): string {
  const genres = take(compact(item.genres ?? []), 2);
  if (genres.length > 0) return genres.join(" · ");
  return item.mediaType === "tv" ? m.command_menu_kind_series() : m.command_menu_kind_film();
}

function mediaSubtitle(item: MediaItem): string {
  return compact([item.year ? String(item.year) : null, mediaGenresLabel(item), item.runtime]).join(
    " · ",
  );
}

function MediaThumb({ item }: { item: MediaItem }) {
  const src = item.poster ?? item.backdrop;
  const Icon = item.mediaType === "tv" ? Tv : Film;
  return (
    <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {src ? (
        <img src={src} alt={item.title} loading="lazy" className="size-full object-cover" />
      ) : (
        <Icon className="size-3.5 text-muted-foreground" />
      )}
    </div>
  );
}

export function MediaRow({ item, onSelect }: { item: MediaItem; onSelect: () => void }) {
  return (
    <CommandItem value={mediaMatchValue(item)} onSelect={onSelect}>
      <MediaThumb item={item} />
      <RowContent
        label={item.title}
        hint={mediaSubtitle(item)}
        badge={
          <span className="shrink-0 rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {item.mediaType === "tv" ? m.command_menu_kind_tv() : m.command_menu_kind_movie()}
          </span>
        }
      />
      <RowAffordance label={m.command_menu_action_open()} />
    </CommandItem>
  );
}
