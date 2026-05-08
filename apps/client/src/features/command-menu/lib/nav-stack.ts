import type { NavFrame } from "../types";

export type NavState = { frames: readonly NavFrame[] };

export type NavAction = { type: "push"; frame: NavFrame } | { type: "pop" } | { type: "reset" };

export const ROOT_FRAME: NavFrame = { kind: "root" };

export const initialNavState: NavState = { frames: [ROOT_FRAME] };

/**
 * Pure reducer for the drill-stack navigation. Root frame at index 0 is
 * invariant — pop floors there so callers can dispatch unconditionally.
 */
export function navReducer(state: NavState, action: NavAction): NavState {
  switch (action.type) {
    case "push":
      return { frames: [...state.frames, action.frame] };
    case "pop":
      return state.frames.length > 1 ? { frames: state.frames.slice(0, -1) } : state;
    case "reset":
      return initialNavState;
  }
}

export function topFrame(state: NavState): NavFrame {
  return state.frames[state.frames.length - 1] ?? ROOT_FRAME;
}

export function isRoot(state: NavState): boolean {
  return state.frames.length === 1;
}
