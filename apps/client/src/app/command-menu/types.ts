import type { LucideIcon } from "lucide-react";
import type { HomeMediaItem } from "@/features/home/lib/types";
import type * as messages from "@/paraglide/messages";

export type MessageKey = keyof typeof messages;

/** Scope is "filtered to a media kind". `null` means "no filter". */
export type CommandScope = null | "tv" | "movie";

/**
 * A subset of the route tree the command menu jumps to. Listed as a literal
 * union so `useNavigate({ to })` stays type-checked against `routeTree.gen`.
 */
export type PageRoute =
  | "/"
  | "/library"
  | "/watchlist"
  | "/settings"
  | "/settings/connections";

export type PageItem = {
  id: string;
  to: PageRoute;
  Icon: LucideIcon;
  labelKey: MessageKey;
  hintKey: MessageKey;
};

export type SearchModeItem = {
  id: string;
  scope: Exclude<CommandScope, null>;
  Icon: LucideIcon;
  labelKey: MessageKey;
  hintKey: MessageKey;
};

export type ActionContext = {
  setScope: (scope: CommandScope) => void;
  close: () => void;
};

export type ActionItem = {
  id: string;
  Icon: LucideIcon;
  labelKey: MessageKey;
  hintKey: MessageKey;
  run: (ctx: ActionContext) => void;
};

export type MediaItem = HomeMediaItem;
