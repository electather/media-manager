import type { LucideIcon } from "lucide-react";
import type { CommandMenuMediaItem } from "@/shared/components/command-menu-media-provider";
import type * as messages from "@/paraglide/messages";

/**
 * Static / parameter-less Paraglide message keys. The dynamic `t(key)`
 * helper relies on this narrowed type — keys that take parameters (like
 * `command_menu_empty_title({ query })`) are deliberately excluded so a
 * call like `t("command_menu_empty_title")` won't compile.
 */
export type StaticMessageKey = {
  [K in keyof typeof messages]: (typeof messages)[K] extends () => string ? K : never;
}[keyof typeof messages];

/** Scope is "filtered to a media kind". `null` means "no filter". */
export type CommandScope = null | "tv" | "movie";

/**
 * A subset of the route tree the command menu jumps to. Listed as a literal
 * union so `useNavigate({ to })` stays type-checked against `routeTree.gen`.
 */
export type PageRoute = "/" | "/library" | "/watchlist" | "/settings" | "/settings/connections";

export type PageItem = {
  id: string;
  to: PageRoute;
  Icon: LucideIcon;
  labelKey: StaticMessageKey;
  hintKey: StaticMessageKey;
};

export type SearchModeItem = {
  id: string;
  scope: Exclude<CommandScope, null>;
  Icon: LucideIcon;
  labelKey: StaticMessageKey;
  hintKey: StaticMessageKey;
};

export type ActionContext = {
  setScope: (scope: CommandScope) => void;
};

export type ActionItem = {
  id: string;
  Icon: LucideIcon;
  labelKey: StaticMessageKey;
  hintKey: StaticMessageKey;
  run: (ctx: ActionContext) => void;
};

export type MediaItem = CommandMenuMediaItem;
