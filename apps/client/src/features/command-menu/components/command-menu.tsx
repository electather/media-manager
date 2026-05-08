import { ChevronDown, ChevronUp, CornerDownLeft } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { m } from "@/paraglide/messages";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/shared/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";
import { Logo } from "@/shared/components/logo";
import { Kbd, KbdGroup } from "@/shared/ui/kbd";

import { useCommandMenuShortcuts } from "../hooks/use-command-menu-shortcuts";
import { useMediaPool } from "../hooks/use-media-pool";
import { useRecentItems } from "../hooks/use-recent-items";
import { useSections } from "../hooks/use-sections";
import { t } from "../lib/i18n";
import { actionMatchValue, pageMatchValue, searchModeMatchValue } from "../lib/match-values";
import { initialNavState, isRoot, navReducer, topFrame } from "../lib/nav-stack";
import { buildCommandActions } from "../registry/actions";
import { COMMAND_PAGES } from "../registry/pages";
import { COMMAND_SEARCH_MODES } from "../registry/search-modes";
import type {
  ActionContext,
  ActionItem,
  CommandScope,
  MediaItem,
  NavFrame,
  PageItem,
  SearchModeItem,
  StaticMessageKey,
} from "../types";
import { CommandSearchHeader } from "./command-search-header";
import { RowAffordance, RowContent, RowIcon } from "./command-row";
import { MediaRow } from "./media-row";

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [navState, dispatch] = useReducer(navReducer, initialNavState);

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

  // Reset menu state on close — drill stack is per-session, recents persist.
  useEffect(() => {
    if (open) return;
    setValue("");
    dispatch({ type: "reset" });
  }, [open]);

  useCommandMenuShortcuts(open, setOpen);

  const close = useCallback(() => setOpen(false), []);
  const popFrame = useCallback(() => dispatch({ type: "pop" }), []);
  const pushFrame = useCallback((frame: NavFrame) => dispatch({ type: "push", frame }), []);

  const top = topFrame(navState);

  const handleSelectPage = useCallback(
    (page: PageItem) => {
      void navigate({ to: page.to });
      close();
    },
    [close, navigate],
  );

  const handleSelectSearchMode = useCallback(
    (mode: SearchModeItem) => {
      pushFrame({ kind: "scope", scope: mode.scope });
      setValue("");
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [pushFrame],
  );

  const handleSelectAction = useCallback(
    (action: ActionItem) => {
      // Action owns the close/push decision via ctx — host doesn't dismiss
      // unconditionally so drill-in actions (cheatsheet, settings) can push
      // a frame without the menu immediately closing on top of them.
      const ctx: ActionContext = { push: pushFrame, close };
      action.run(ctx);
    },
    [close, pushFrame],
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

  // Backspace at the very start of an empty input pops one drill frame —
  // matches the muscle-memory most "Notion-style" command menus expose.
  const onInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace" && !value && !isRoot(navState)) {
        event.preventDefault();
        popFrame();
      }
    },
    [navState, popFrame, value],
  );

  const sections = useSections({ topFrame: top, value, recents, pool, trending });

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
            topFrame={top}
            onValueChange={setValue}
            onPopFrame={popFrame}
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

            {sections.scope && sections.trendingItems.length > 0 && (
              <CommandGroup heading={t(getTrendingHeadingKey(sections.scope))}>
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
              <CommandGroup heading={t(getMediaHeadingKey(sections.scope))}>
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

function getMediaHeadingKey(scope: CommandScope): StaticMessageKey {
  if (scope === "tv") return "command_menu_section_media_tv";
  if (scope === "movie") return "command_menu_section_media_movie";
  return "command_menu_section_media_default";
}

function getTrendingHeadingKey(scope: Exclude<CommandScope, null>): StaticMessageKey {
  return scope === "tv"
    ? "command_menu_section_trending_tv"
    : "command_menu_section_trending_movie";
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
