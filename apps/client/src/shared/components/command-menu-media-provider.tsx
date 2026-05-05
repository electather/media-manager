import { createContext, type ReactNode, useContext } from "react";
import type { CompactMediaItem } from "@ent-mcp/shared/home";

/**
 * Media item shape the command menu fuzzy-matches and renders. Layered on
 * top of the wire `CompactMediaItem` with optional client-side fields the
 * mock feed already supplies (tags, runtime, director, cast).
 */
export type CommandMenuMediaItem = CompactMediaItem & {
  tags?: string[];
  runtime?: string;
  director?: string;
  cast?: string[];
};

export type CommandMenuMediaSource = {
  /** Deduplicated pool of every searchable title. */
  pool: CommandMenuMediaItem[];
  /** Trending subset used by the scope-filtered "browse" view. */
  trending: CommandMenuMediaItem[];
};

const EMPTY: CommandMenuMediaSource = { pool: [], trending: [] };
const Context = createContext<CommandMenuMediaSource>(EMPTY);

/**
 * Wraps the part of the tree where the command menu renders. The route
 * layer (which is allowed to depend on feature data) sources the items and
 * passes them in; the menu itself stays feature-agnostic.
 */
export function CommandMenuMediaProvider({
  value,
  children,
}: {
  value: CommandMenuMediaSource;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useCommandMenuMedia(): CommandMenuMediaSource {
  return useContext(Context);
}
