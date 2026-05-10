// Section drill-down navigation transitions for the settings and admin
// shells. We drive `document.startViewTransition` ourselves and use
// `flushSync` to force Tanstack Router's commit to land inside the
// transition callback — without the flush, Tanstack defers the route swap
// via useSyncExternalStore, the "after" snapshot matches the "before", and
// the browser skips the animation. We also call `addTransitionType` so a
// future `<ViewTransition>` integration can pick directional classes.

import { addTransitionType, startTransition } from "react";
import { flushSync } from "react-dom";

export type SectionDirection = "nav-forward" | "nav-back";

const MOBILE_QUERY = "(max-width: 767px)";

function supportsViewTransitions(): boolean {
  if (typeof document === "undefined") return false;
  return typeof document.startViewTransition === "function";
}

function isNarrowViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * Trigger a directional section navigation. On a supporting browser at a
 * narrow viewport we mark <html> with `data-vt=nav-forward|nav-back` so
 * `globals.css` can pick the right slide, kick off
 * `document.startViewTransition`, and use `flushSync` to commit Tanstack's
 * route change synchronously inside the callback so the browser sees the
 * post-navigation tree as the "after" snapshot.
 */
export async function startSectionNav(
  direction: SectionDirection,
  navigate: () => Promise<unknown> | void,
): Promise<void> {
  if (!supportsViewTransitions() || !isNarrowViewport()) {
    void navigate();
    return;
  }
  document.documentElement.dataset.vt = direction;
  const transition = document.startViewTransition(() => {
    flushSync(() => {
      startTransition(() => {
        addTransitionType(direction);
        void navigate();
      });
    });
  });
  try {
    await transition.finished;
  } finally {
    delete document.documentElement.dataset.vt;
  }
}

function isModifiedClick(event: React.MouseEvent<Element>): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/**
 * onClick handler for an anchor/Link that triggers a directional section
 * transition while letting modifier-clicks fall through to native behavior.
 */
export function sectionTransitionClickHandler(
  direction: SectionDirection,
  navigate: () => Promise<unknown> | void,
) {
  return (event: React.MouseEvent<Element>) => {
    if (isModifiedClick(event) || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    void startSectionNav(direction, navigate);
  };
}
