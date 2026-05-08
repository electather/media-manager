import { ChevronDown, ChevronUp, CornerDownLeft, RefreshCw } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
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

import { useBoundSettings } from "../hooks/use-bound-settings";
import { useCommandHotkeys } from "../hooks/use-command-hotkeys";
import { useMediaPool } from "../hooks/use-media-pool";
import { useRecentItems } from "../hooks/use-recent-items";
import { useSearchResults } from "../hooks/use-search-results";
import { useSections } from "../hooks/use-sections";
import { t } from "../lib/i18n";
import { actionMatchValue, pageMatchValue, searchModeMatchValue } from "../lib/match-values";
import { initialNavState, isRoot, navReducer, topFrame } from "../lib/nav-stack";
import { COMMAND_ACTIONS } from "../registry/actions";
import { COMMAND_PAGES } from "../registry/pages";
import { COMMAND_SEARCH_MODES } from "../registry/search-modes";
import type {
  ActionContext,
  ActionItem,
  CommandScope,
  Contribution,
  MediaItem,
  NavFrame,
  PageItem,
  SearchModeItem,
  SettingItem,
  StaticMessageKey,
} from "../types";
import { CommandSearchHeader } from "./command-search-header";
import { RowAffordance, RowContent, RowIcon } from "./command-row";
import { MediaRow } from "./media-row";
import { SettingDrill } from "./setting-drill";
import { ShortcutsCheatsheet } from "./shortcuts-cheatsheet";

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [navState, dispatch] = useReducer(navReducer, initialNavState);

  const inputRef = useRef<HTMLInputElement>(null);

  const { recents, pushRecent } = useRecentItems();
  const { pool, trending } = useMediaPool();
  const settings = useBoundSettings();

  const navigate = useNavigate();

  // Reset menu state on close — drill stack is per-session, recents persist.
  useEffect(() => {
    if (open) return;
    setValue("");
    dispatch({ type: "reset" });
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  const popFrame = useCallback(() => dispatch({ type: "pop" }), []);
  const pushFrame = useCallback((frame: NavFrame) => dispatch({ type: "push", frame }), []);

  const top = topFrame(navState);
  const popOrClose = useCallback(() => {
    if (isRoot(navState)) close();
    else popFrame();
  }, [close, navState, popFrame]);

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

  const handleSelectSetting = useCallback(
    (setting: SettingItem<string>) => pushFrame({ kind: "setting", settingId: setting.id }),
    [pushFrame],
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

  const runContribution = useCallback(
    (item: Contribution) => {
      if (item.kind === "page") return handleSelectPage(item);
      if (item.kind === "action") return handleSelectAction(item);
      if (item.kind === "search-mode") return handleSelectSearchMode(item);
      if (item.kind === "setting") return handleSelectSetting(item);
    },
    [handleSelectAction, handleSelectPage, handleSelectSearchMode, handleSelectSetting],
  );

  const allContributions = useMemo<readonly Contribution[]>(
    () => [...COMMAND_PAGES, ...COMMAND_SEARCH_MODES, ...COMMAND_ACTIONS, ...settings],
    [settings],
  );

  useCommandHotkeys({
    open,
    setOpen,
    popOrClose,
    contributions: allContributions,
    runContribution,
  });

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

  const scopeForSearch: CommandScope = top.kind === "scope" ? top.scope : null;
  const search = useSearchResults(value, scopeForSearch);

  const sections = useSections({
    topFrame: top,
    value,
    recents,
    pool,
    trending,
    searchResults: search.data?.results,
  });

  const activeSetting =
    top.kind === "setting" ? settings.find((s) => s.id === top.settingId) : undefined;

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

            {top.kind === "cheatsheet" && <ShortcutsCheatsheet />}

            {activeSetting && <SettingDrill setting={activeSetting} onPop={popFrame} />}

            {top.kind !== "cheatsheet" && top.kind !== "setting" && (
              <>
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

                {search.isError && (
                  <CommandGroup heading={m.command_menu_search_error_title()}>
                    <CommandItem value="search-retry" onSelect={search.refetch}>
                      <RowIcon Icon={RefreshCw} />
                      <RowContent
                        label={m.command_menu_search_error_retry()}
                        hint={search.error?.message ?? ""}
                      />
                    </CommandItem>
                  </CommandGroup>
                )}

                {sections.mediaItems.length > 0 && (
                  <CommandGroup heading={t(getResultsHeadingKey(sections.scope))}>
                    {sections.mediaItems.map((item) => (
                      <MediaRow
                        key={`media:${item.id}`}
                        item={item}
                        onSelect={() => handleSelectMedia(item)}
                      />
                    ))}
                  </CommandGroup>
                )}

                {sections.showSettings && settings.length > 0 && (
                  <CommandGroup heading={t("command_menu_section_settings")}>
                    {settings.map((setting) => (
                      <CommandItem
                        key={setting.id}
                        value={`${setting.id} ${t(setting.labelKey)} ${t(setting.hintKey)}`}
                        onSelect={() => handleSelectSetting(setting)}
                      >
                        <RowIcon Icon={setting.Icon} />
                        <RowContent
                          label={t(setting.labelKey)}
                          hint={t(setting.hintKey)}
                          hotkey={setting.hotkey}
                          badge={
                            <span className="shrink-0 rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                              {currentSettingValueLabel(setting)}
                            </span>
                          }
                        />
                        <RowAffordance label={m.command_menu_action_open()} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {sections.showActions && COMMAND_ACTIONS.length > 0 && (
                  <CommandGroup heading={t("command_menu_section_actions")}>
                    {COMMAND_ACTIONS.map((action) => (
                      <CommandItem
                        key={action.id}
                        value={actionMatchValue(action)}
                        onSelect={() => handleSelectAction(action)}
                      >
                        <RowIcon Icon={action.Icon} />
                        <RowContent
                          label={t(action.labelKey)}
                          hint={t(action.hintKey)}
                          hotkey={action.hotkey}
                        />
                        <RowAffordance label={m.command_menu_action_run()} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>

          <CommandFooter />
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function currentSettingValueLabel(setting: SettingItem<string>): string {
  const current = setting.read();
  const opt = setting.options.find((o) => o.id === current);
  return opt ? t(opt.labelKey) : current;
}

function getResultsHeadingKey(scope: CommandScope): StaticMessageKey {
  if (scope === "tv") return "command_menu_section_results_tv";
  if (scope === "movie") return "command_menu_section_results_movie";
  return "command_menu_section_results";
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
