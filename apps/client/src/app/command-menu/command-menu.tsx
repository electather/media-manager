import { Command as CommandPrimitive } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, CornerDownLeft, Film, SearchIcon, Tv, X } from "lucide-react";
import { useTheme } from "next-themes";
import {
  type KeyboardEvent,
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
} from "./types";
import { useMediaPool } from "./use-media-pool";
import { useRecentItems } from "./use-recent-items";

const OPEN_EVENT = "nama:open-command";

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

  // Global shortcuts: ⌘K / Ctrl+K toggles, "/" opens (when not typing).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (open) return;
      if (event.key !== "/") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Allow non-React triggers (e.g. the search button in the top nav) to open
  // the menu by dispatching a custom event.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleSelectPage = useCallback(
    (page: PageItem) => {
      void navigate({ to: page.to });
      close();
    },
    [close, navigate],
  );

  const handleSelectSearchMode = useCallback(
    (mode: SearchModeItem) => {
      setScope(mode.scope);
      setValue("");
      focusInput();
    },
    [focusInput],
  );

  const handleSelectAction = useCallback(
    (action: ActionItem) => {
      const ctx: ActionContext = { setScope, close };
      action.run(ctx);
      close();
    },
    [close],
  );

  const handleSelectMedia = useCallback(
    (item: MediaItem) => {
      pushRecent(item.id);
      // TODO(media-detail): open the media detail modal once it lands.
      close();
    },
    [close, pushRecent],
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

  const showSearchModes = !scope && !value;
  const showRecent = !scope && !value && recents.length > 0;
  const showActions = !scope;
  const showPages = !scope;
  const showTrending = scope !== null && !value;

  const recentItems = useMemo(
    () => recents.map((id) => pool.find((p) => p.id === id)).filter((x): x is MediaItem => x != null),
    [pool, recents],
  );

  const trendingScoped = useMemo(() => {
    if (!scope) return [] as MediaItem[];
    const seen = new Set<string>();
    const out: MediaItem[] = [];
    const push = (item: MediaItem) => {
      if (item.mediaType === scope && !seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    };
    trending.forEach(push);
    if (out.length < 8) pool.forEach(push);
    return out.slice(0, 8);
  }, [pool, scope, trending]);

  const mediaPool = useMemo(
    () => (scope ? pool.filter((item) => item.mediaType === scope) : pool),
    [pool, scope],
  );

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

            {showSearchModes && (
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

            {showRecent && (
              <CommandGroup heading={t("command_menu_section_recent")}>
                {recentItems.slice(0, 4).map((item) => (
                  <MediaRow
                    key={`recent:${item.id}`}
                    item={item}
                    onSelect={() => handleSelectMedia(item)}
                  />
                ))}
              </CommandGroup>
            )}

            {showPages && (
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

            {showTrending && trendingScoped.length > 0 && (
              <CommandGroup heading={t(getTrendingHeadingKey(scope))}>
                {trendingScoped.map((item) => (
                  <MediaRow
                    key={`trending:${item.id}`}
                    item={item}
                    onSelect={() => handleSelectMedia(item)}
                  />
                ))}
              </CommandGroup>
            )}

            {!showTrending && mediaPool.length > 0 && (
              <CommandGroup heading={t(getMediaHeadingKey(scope))}>
                {mediaPool.map((item) => (
                  <MediaRow
                    key={`media:${item.id}`}
                    item={item}
                    onSelect={() => handleSelectMedia(item)}
                  />
                ))}
              </CommandGroup>
            )}

            {showActions && (
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

function ScopeChip({ scope, onClear }: { scope: Exclude<CommandScope, null>; onClear: () => void }) {
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

function getMediaHeadingKey(scope: CommandScope) {
  if (scope === "tv") return "command_menu_section_media_tv" as const;
  if (scope === "movie") return "command_menu_section_media_movie" as const;
  return "command_menu_section_media_default" as const;
}

function getTrendingHeadingKey(scope: CommandScope) {
  return scope === "tv"
    ? ("command_menu_section_trending_tv" as const)
    : ("command_menu_section_trending_movie" as const);
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
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <Icon className="size-3.5 text-muted-foreground" />
      )}
    </div>
  );
}

function mediaSubtitle(item: MediaItem): string {
  const parts: string[] = [];
  if (item.year) parts.push(String(item.year));
  const genres = (item.genres ?? []).slice(0, 2).filter(Boolean);
  if (genres.length > 0) {
    parts.push(genres.join(" · "));
  } else {
    parts.push(item.mediaType === "tv" ? m.command_menu_kind_series() : m.command_menu_kind_film());
  }
  if (item.runtime) parts.push(item.runtime);
  return parts.join(" · ");
}

function mediaMatchValue(item: MediaItem): string {
  // cmdk fuzzy-matches against the `value` string. Title comes first so
  // prefix matches on the title score highest; everything else (year,
  // genres, tags, director, cast) is appended to broaden hits — a query for
  // "atmos" or a cast name still finds the right title.
  return [
    item.title,
    item.year,
    item.genres?.join(" "),
    item.tags?.join(" "),
    item.mediaType === "tv" ? "tv show series" : "movie film",
    item.director,
    item.cast?.join(" "),
    item.id,
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

function RowContent({
  label,
  hint,
  badge,
}: {
  label: string;
  hint: string;
  badge?: React.ReactNode;
}) {
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
    <CommandShortcut className="hidden items-center gap-1.5 text-[11px] text-muted-foreground/80 group-data-selected/command-item:flex">
      <span>{label}</span>
      <Kbd className="border border-border">
        <CornerDownLeft className="size-3" />
      </Kbd>
    </CommandShortcut>
  );
}

function CommandFooter() {
  return (
    <footer className="flex items-center justify-between border-t border-border bg-card/40 px-3 py-2 text-[11px] text-muted-foreground/80">
      <KbdGroup className="gap-3.5">
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
      <span className="font-medium">{m.home_nav_brand_label()}</span>
    </footer>
  );
}
