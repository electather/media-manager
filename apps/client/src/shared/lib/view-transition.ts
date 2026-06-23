// Section drill-down transitions: manually call `document.startViewTransition` and
// use `flushSync` to commit Tanstack's route swap inside the callback — without it,
// Tanstack defers via useSyncExternalStore and "after" snapshot matches "before".

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

// `transition.finished` legitimately rejects when the user navigates again
// mid-transition, the tab is hidden, the DOM update times out, or the
// transition lands in an invalid state. None of those are runtime errors —
// they are normal user/browser flow that we should swallow so the global
// `unhandledrejection` handler does not log them as diagnostics.
export function isExpectedTransitionAbort(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return (
    err.name === "AbortError" || err.name === "TimeoutError" || err.name === "InvalidStateError"
  );
}

/**
 * Trigger directional section nav. On a supporting browser at narrow viewport,
 * mark <html> with `data-vt=nav-forward|nav-back` for `globals.css` to pick the
 * slide, and use `flushSync` to commit Tanstack's route change inside the transition.
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
    await transition.finished.catch((err: unknown) => {
      if (!isExpectedTransitionAbort(err)) throw err;
    });
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
