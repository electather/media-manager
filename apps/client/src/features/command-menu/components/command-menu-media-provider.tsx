import { createContext, type ReactNode, useContext } from "react";

import type { CommandMenuMediaSource } from "../types";

export type { CommandMenuMediaItem, CommandMenuMediaSource } from "../types";

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
