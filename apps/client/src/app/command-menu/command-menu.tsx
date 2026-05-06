import { Command as CommandPrimitive } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, CornerDownLeft, Film, SearchIcon, Tv, X } from "lucide-react";
import { useTheme } from "next-themes";
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/shared/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import { Logo } from "@/shared/components/logo";
import { Kbd, KbdGroup } from "@/shared/ui/kbd";

import { buildCommandActions, COMMAND_PAGES, COMMAND_SEARCH_MODES } from "./command-menu-data";
import { t } from "./i18n";
import type {
  ActionContext,
  ActionItem,
  CommandScope,
  MediaItem,
  PageItem,
  SearchModeItem,
  StaticMessageKey,
} from "./types";
import { useCommandMenuShortcuts } from "./use-command-menu-shortcuts";
import { useMediaPool } from "./use-media-pool";
import { useRecentItems } from "./use-recent-items";

const TRENDING_LIMIT = 8;
const RECENTS_LIMIT = 4;

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<CommandScope>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const { recents, pushRecent } = useRecentItems();
  const { pool, trending } = useMediaPool();

  const navigate = useNavigate();
  const { theme, resolvedTheme, setTheme } = useTheme();

  const actions = useMemo(
    () =>
      buildCommandActions({
        setTheme,
        resolveTheme: () => theme ?? resolvedTheme,
      }),
    [setTheme, theme, resolvedTheme],
  );

  // Reset menu state on close.
  useEffect(() => {
    if (open) return;
    setValue("");
    setScope(null);
  }, [open]);

  useCommandMenuShortcuts(open, setOpen);

  const close = useCallback(() => setOpen(false), []);

  const handleSelectPage = useCallback(
    (page: PageItem) => {
      void navigate({ to: page.to });
      close();
    },
    [close, navigate],
  );

  const handleSelectSearchMode = useCallback((mode: SearchModeItem) => {
    setScope(mode.scope);
    setValue("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleSelectAction = useCallback(
    (action: ActionItem) => {
      const ctx: ActionContext = { setScope };
      action.run(ctx);
      close();
    },
    [close],
  );

  const handleSelectMedia = useCallback(
    (item: MediaItem) => {
      pushRecent(item.id);
      // The `MediaDetailModal` is mounted inside `HomeFeed`, so peek only
      // resolves on the home route. Always land on `/` so a media pick from
      // any authenticated page still opens the modal.
      void navigate({ to: "/", search: { peek: item.id } });
      close();
    },
    [close, navigate, pushRecent],
  );

  // Backspace at the very start of an empty input clears the active scope —
  // matches the muscle-memory most "Notion-style" command menus expose.
  const onInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace" && !value && scope) {
        event.preventDefault();
        setScope(null);
      }
    },
    [scope, value],
  );

  const sections = useSections({ scope, value, recents, pool, trending });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-[640px]"
      >
        <DialogTitle className="sr-only">{m.command_menu_title()}</DialogTitle>
        <DialogDescription className="sr-only">{m.command_menu_description()}</DialogDescription>

        <Command loop label={m.command_menu_title()}>
          <CommandSearchHeader
            ref={inputRef}
            value={value}
            scope={scope}
            onValueChange={setValue}
            onScopeClear={() => setScope(null)}
            onKeyDown={onInputKeyDown}
          />

          <CommandList>
            <CommandEmpty>
              <div className="flex flex-col items-center gap-1.5 py-2">
                <span>{m.command_menu_empty_title({ query: value })}</span>
                <span className="text-xs">{m.command_menu_empty_subtitle()}</span>
              </div>
            </CommandEmpty>

            {sections.showSearchModes && (
              <CommandGroup heading={t("command_menu_section_search")}>
                {COMMAND_SEARCH_MODES.map((mode) => (
                  <CommandItem
                    key={mode.id}
                    value={searchModeMatchValue(mode)}
                    onSelect={() => handleSelectSearchMode(mode)}
                  >
                    <RowIcon Icon={mode.Icon} />
                    <RowContent label={t(mode.labelKey)} hint={t(mode.hintKey)} />
                    <RowAffordance label={m.command_menu_action_open()} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {sections.recentItems.length > 0 && (
              <CommandGroup heading={t("command_menu_section_recent")}>
                {sections.recentItems.map((item) => (
                  <MediaRow
                    key={`recent:${item.id}`}
                    item={item}
                    onSelect={() => handleSelectMedia(item)}
                  />
                ))}
              </CommandGroup>
            )}

            {sections.showPages && (
              <CommandGroup heading={t("command_menu_section_pages")}>
                {COMMAND_PAGES.map((page) => (
                  <CommandItem
                    key={page.id}
                    value={pageMatchValue(page)}
                    onSelect={() => handleSelectPage(page)}
                  >
                    <RowIcon Icon={page.Icon} />
                    <RowContent label={t(page.labelKey)} hint={t(page.hintKey)} />
                    <RowAffordance label={m.command_menu_action_go()} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {sections.trendingItems.length > 0 && (
              <CommandGroup heading={t(getTrendingHeadingKey(scope))}>
                {sections.trendingItems.map((item) => (
                  <MediaRow
                    key={`trending:${item.id}`}
                    item={item}
                    onSelect={() => handleSelectMedia(item)}
                  />
                ))}
              </CommandGroup>
            )}

            {sections.mediaItems.length > 0 && (
              <CommandGroup heading={t(getMediaHeadingKey(scope))}>
                {sections.mediaItems.map((item) => (
                  <MediaRow
                    key={`media:${item.id}`}
                    item={item}
                    onSelect={() => handleSelectMedia(item)}
                  />
                ))}
              </CommandGroup>
            )}

            {sections.showActions && (
              <CommandGroup heading={t("command_menu_section_actions")}>
                {actions.map((action) => (
                  <CommandItem
                    key={action.id}
                    value={actionMatchValue(action)}
                    onSelect={() => handleSelectAction(action)}
                  >
                    <RowIcon Icon={action.Icon} />
                    <RowContent label={t(action.labelKey)} hint={t(action.hintKey)} />
                    <RowAffordance label={m.command_menu_action_run()} />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>

          <CommandFooter />
        </Command>
      </DialogContent>
    </Dialog>
  );
}

type SectionsInput = {
  scope: CommandScope;
  value: string;
  recents: string[];
  pool: MediaItem[];
  trending: MediaItem[];
};

function useSections({ scope, value, recents, pool, trending }: SectionsInput) {
  const showSearchModes = scope === null && !value;
  const showPages = scope === null;
  const showActions = scope === null;
  const showTrending = scope !== null && !value;

  const recentItems = useMemo(() => {
    if (scope || value) return [] as MediaItem[];
    return recents
      .map((id) => pool.find((item) => item.id === id))
      .filter((x): x is MediaItem => x != null)
      .slice(0, RECENTS_LIMIT);
  }, [pool, recents, scope, value]);

  const trendingItems = useMemo(() => {
    if (!showTrending || !scope) return [] as MediaItem[];
    const seen = new Set<string>();
    const out: MediaItem[] = [];
    const push = (item: MediaItem) => {
      if (item.mediaType !== scope || seen.has(item.id)) return;
      seen.add(item.id);
      out.push(item);
    };
    trending.forEach(push);
    if (out.length < TRENDING_LIMIT) pool.forEach(push);
    return out.slice(0, TRENDING_LIMIT);
  }, [pool, scope, showTrending, trending]);

  const mediaItems = useMemo(() => {
    if (showTrending) return [] as MediaItem[];
    return scope ? pool.filter((item) => item.mediaType === scope) : pool;
  }, [pool, scope, showTrending]);

  return { showSearchModes, showPages, showActions, recentItems, trendingItems, mediaItems };
}

type CommandSearchHeaderProps = {
  ref?: Ref<HTMLInputElement>;
  value: string;
  scope: CommandScope;
  onValueChange: (next: string) => void;
  onScopeClear: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
};

function CommandSearchHeader({
  ref,
  value,
  scope,
  onValueChange,
  onScopeClear,
  onKeyDown,
}: CommandSearchHeaderProps) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex items-center gap-2 border-b border-border px-3 py-2.5"
    >
      <SearchIcon className="size-4 shrink-0 text-muted-foreground/80" aria-hidden="true" />
      {scope && <ScopeChip scope={scope} onClear={onScopeClear} />}
      <CommandPrimitive.Input
        ref={ref}
        value={value}
        onValueChange={onValueChange}
        onKeyDown={onKeyDown}
        placeholder={getPlaceholder(scope)}
        // Auto-detect direction so RTL queries (e.g. Persian/Arabic titles)
        // display naturally without forcing a global `dir` on the popup.
        dir="auto"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={cn(
          "flex-1 bg-transparent py-1 text-sm text-foreground outline-hidden placeholder:text-muted-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
      <Kbd className="border border-border">esc</Kbd>
    </div>
  );
}

function getPlaceholder(scope: CommandScope): string {
  if (scope === "tv") return m.command_menu_search_placeholder_tv();
  if (scope === "movie") return m.command_menu_search_placeholder_movie();
  return m.command_menu_search_placeholder();
}

function ScopeChip({
  scope,
  onClear,
}: {
  scope: Exclude<CommandScope, null>;
  onClear: () => void;
}) {
  const Icon = scope === "tv" ? Tv : Film;
  const label = scope === "tv" ? m.command_menu_kind_tv() : m.command_menu_kind_movie();
  return (
    <button
      type="button"
      onClick={onClear}
      title={m.command_menu_scope_clear_hint()}
      aria-label={m.command_menu_scope_clear()}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5",
        "text-xs font-medium text-primary outline-none transition-colors hover:bg-primary/15",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      <Icon className="size-3" />
      {label}
      <X className="size-3 opacity-70" />
    </button>
  );
}

function getMediaHeadingKey(scope: CommandScope): StaticMessageKey {
  if (scope === "tv") return "command_menu_section_media_tv";
  if (scope === "movie") return "command_menu_section_media_movie";
  return "command_menu_section_media_default";
}

function getTrendingHeadingKey(scope: CommandScope): StaticMessageKey {
  return scope === "tv"
    ? "command_menu_section_trending_tv"
    : "command_menu_section_trending_movie";
}

function MediaRow({ item, onSelect }: { item: MediaItem; onSelect: () => void }) {
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

function mediaGenresLabel(item: MediaItem): string {
  const genres = (item.genres ?? []).slice(0, 2).filter(Boolean);
  if (genres.length > 0) return genres.join(" · ");
  return item.mediaType === "tv" ? m.command_menu_kind_series() : m.command_menu_kind_film();
}

function mediaSubtitle(item: MediaItem): string {
  const parts: string[] = [];
  if (item.year) parts.push(String(item.year));
  parts.push(mediaGenresLabel(item));
  if (item.runtime) parts.push(item.runtime);
  return parts.join(" · ");
}

function mediaMatchValue(item: MediaItem): string {
  // cmdk fuzzy-matches against the `value` string. Title comes first so
  // prefix matches on the title score highest; everything else (year,
  // genres, tags, director, cast) is appended to broaden hits — a query for
  // "atmos" or a cast name still finds the right title. Note that we leave
  // `item.id` out — id strings like `tv:tt0898266` would otherwise leak
  // into fuzzy space and surface unintended hits for partial-id queries.
  return [
    item.title,
    item.year,
    item.genres?.join(" "),
    item.tags?.join(" "),
    item.mediaType === "tv" ? "tv show series" : "movie film",
    item.director,
    item.cast?.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
}

function pageMatchValue(page: PageItem): string {
  return `${page.id} ${t(page.labelKey)} ${t(page.hintKey)}`;
}

function searchModeMatchValue(mode: SearchModeItem): string {
  return `${mode.id} ${t(mode.labelKey)} ${t(mode.hintKey)}`;
}

function actionMatchValue(action: ActionItem): string {
  return `${action.id} ${t(action.labelKey)} ${t(action.hintKey)}`;
}

function RowIcon({ Icon }: { Icon: typeof Tv }) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      <Icon className="size-3.5" />
    </div>
  );
}

function RowContent({ label, hint, badge }: { label: string; hint: string; badge?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
        <span className="truncate">{label}</span>
        {badge}
      </div>
      <div className="truncate text-xs text-muted-foreground/80">{hint}</div>
    </div>
  );
}

function RowAffordance({ label }: { label: string }) {
  return (
    <CommandShortcut className="hidden items-center gap-1.5 text-[11px] text-muted-foreground/80 group-data-[selected=true]/command-item:flex">
      <span>{label}</span>
      <Kbd className="border border-border">
        <CornerDownLeft className="size-3" />
      </Kbd>
    </CommandShortcut>
  );
}

function CommandFooter() {
  return (
    <footer className="flex items-center justify-between gap-3 border-t border-border bg-card/40 px-3 py-2 text-[11px] text-muted-foreground/80">
      {/* Keyboard hints are only meaningful on devices with a real keyboard
          (i.e. a fine pointer). Touch-first devices hide the group entirely
          and let the brand fill the row. */}
      <KbdGroup className="hidden gap-3.5 pointer-fine:inline-flex">
        <span className="inline-flex items-center gap-1.5">
          <Kbd className="border border-border">
            <ChevronUp className="size-3" />
          </Kbd>
          <Kbd className="border border-border">
            <ChevronDown className="size-3" />
          </Kbd>
          {m.command_menu_footer_navigate()}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd className="border border-border">
            <CornerDownLeft className="size-3" />
          </Kbd>
          {m.command_menu_footer_select()}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd className="border border-border">esc</Kbd>
          {m.command_menu_footer_close()}
        </span>
      </KbdGroup>
      <Logo aria-label={m.home_nav_brand_label()} className="ms-auto size-4 shrink-0" />
    </footer>
  );
}
