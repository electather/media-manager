import type { LucideIcon } from "lucide-react";
import type { CompactMediaItem } from "@nama/shared/home";
import type * as messages from "@/paraglide/messages";

/** Paraglide message keys with no parameters. Excludes keys like `command_menu_empty_title({ query })` so `t("command_menu_empty_title")` fails at compile time. */
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

export type ContributionKind = "page" | "action" | "search-mode" | "setting";

type Base = {
  /** Unique across all contribution kinds. */
  id: string;
  Icon: LucideIcon;
  labelKey: StaticMessageKey;
  hintKey: StaticMessageKey;
  /**
   * Hide row when false. Lets features gate via flag/role. Evaluated on
   * every render of the menu surface — caller must keep thunk cheap or
   * memoize feature-flag reads upstream.
   */
  enabled?: () => boolean;
  /** Order inside group; lower first. Default 100. */
  order?: number;
  /** Optional global hotkey (e.g. "Mod+Shift+T"). Wired in phase 4. */
  hotkey?: string;
};

export type PageItem = Base & {
  kind: "page";
  to: PageRoute;
  /** Optional vim-sequence (e.g. ["G","H"]) registered while the menu is closed. */
  sequence?: readonly string[];
};

export type ActionItem = Base & {
  kind: "action";
  run: (ctx: ActionContext) => void;
};

export type SearchModeItem = Base & {
  kind: "search-mode";
  scope: Exclude<CommandScope, null>;
};

export type SettingOption<T extends string> = {
  id: T;
  Icon?: LucideIcon;
  labelKey: StaticMessageKey;
  hintKey?: StaticMessageKey;
};

export type SettingItem<T extends string = string> = Base & {
  kind: "setting";
  options: readonly SettingOption<T>[];
  read: () => T;
  write: (next: T) => void;
  /** Toast on successful write. */
  toastKey?: StaticMessageKey;
};

export type Contribution = PageItem | ActionItem | SearchModeItem | SettingItem;

export type NavFrame =
  | { kind: "root" }
  | { kind: "scope"; scope: Exclude<CommandScope, null> }
  | { kind: "setting"; settingId: string }
  | { kind: "cheatsheet" };

export type ActionContext = {
  push: (frame: NavFrame) => void;
  close: () => void;
};

/** Wire shape from endpoint. Fields like `runtime`, `director`, `cast` were removed (never returned live) to prevent silent no-ops in fuzzy match. */
export type MediaItem = CompactMediaItem;
