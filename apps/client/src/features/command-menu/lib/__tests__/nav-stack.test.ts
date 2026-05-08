import { describe, expect, it } from "vite-plus/test";

import { initialNavState, isRoot, navReducer, topFrame, type NavState } from "../nav-stack";

describe("navReducer", () => {
  it("starts with a single root frame", () => {
    expect(initialNavState.frames).toHaveLength(1);
    expect(initialNavState.frames[0]).toEqual({ kind: "root" });
    expect(isRoot(initialNavState)).toBe(true);
  });

  it("push appends a frame and updates the top", () => {
    const next = navReducer(initialNavState, {
      type: "push",
      frame: { kind: "scope", scope: "tv" },
    });
    expect(next.frames).toHaveLength(2);
    expect(topFrame(next)).toEqual({ kind: "scope", scope: "tv" });
    expect(isRoot(next)).toBe(false);
  });

  it("pop removes the top frame", () => {
    const pushed = navReducer(initialNavState, {
      type: "push",
      frame: { kind: "cheatsheet" },
    });
    const popped = navReducer(pushed, { type: "pop" });
    expect(popped.frames).toEqual(initialNavState.frames);
  });

  it("pop floors at the root frame", () => {
    const popped = navReducer(initialNavState, { type: "pop" });
    expect(popped).toBe(initialNavState);
  });

  it("reset returns the initial state regardless of depth", () => {
    let state: NavState = initialNavState;
    state = navReducer(state, { type: "push", frame: { kind: "scope", scope: "movie" } });
    state = navReducer(state, { type: "push", frame: { kind: "setting", settingId: "set:theme" } });
    expect(state.frames).toHaveLength(3);

    const reset = navReducer(state, { type: "reset" });
    // Same reference avoids needless re-renders downstream — matches the
    // pop-floor optimization the test above asserts.
    expect(reset).toBe(initialNavState);
  });

  it("preserves frame ordering when pushed multiple times", () => {
    let state: NavState = initialNavState;
    const sequence: NavState["frames"][number][] = [
      { kind: "scope", scope: "tv" },
      { kind: "setting", settingId: "set:theme" },
      { kind: "cheatsheet" },
    ];
    for (const frame of sequence) {
      state = navReducer(state, { type: "push", frame });
    }
    expect(state.frames.slice(1)).toEqual(sequence);
  });
});
