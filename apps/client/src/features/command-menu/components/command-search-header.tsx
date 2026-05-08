import { Command as CommandPrimitive } from "cmdk";
import { Film, SearchIcon, Tv, X } from "lucide-react";
import type { KeyboardEvent, Ref } from "react";

import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { Kbd } from "@/shared/ui/kbd";

import type { CommandScope, NavFrame } from "../types";

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

export type CommandSearchHeaderProps = {
  ref?: Ref<HTMLInputElement>;
  value: string;
  /** Top frame in the nav-stack — drives the scope chip + placeholder. */
  topFrame: NavFrame;
  onValueChange: (next: string) => void;
  onPopFrame: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
};

export function CommandSearchHeader({
  ref,
  value,
  topFrame,
  onValueChange,
  onPopFrame,
  onKeyDown,
}: CommandSearchHeaderProps) {
  const scope: CommandScope = topFrame.kind === "scope" ? topFrame.scope : null;
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex items-center gap-2 border-b border-border px-3 py-2.5"
    >
      <SearchIcon className="size-4 shrink-0 text-muted-foreground/80" aria-hidden="true" />
      {scope && <ScopeChip scope={scope} onClear={onPopFrame} />}
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
