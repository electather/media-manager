import { useEffect, useRef } from "react";

// Emitted by `CommandMenuTrigger` (the search button in the top nav).
// Inherited from the nama-prototype event name for wire-compatibility — keep
// the literal in sync if the trigger ever changes.
const OPEN_EVENT = "nama:open-command";

function hasModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.altKey;
}

function isToggleShortcut(event: KeyboardEvent): boolean {
  if (!event.metaKey && !event.ctrlKey) return false;
  return event.key === "k" || event.key === "K";
}

function isSlashShortcut(event: KeyboardEvent): boolean {
  if (event.key !== "/" || hasModifier(event)) return false;
  return !isTypingInField(event.target);
}

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  return target.isContentEditable;
}

/**
 * Wires up the global keyboard shortcuts and custom-event opener that drive
 * the command menu. Kept isolated so the component itself stays focused on
 * rendering and selection state.
 *
 * - ⌘K / Ctrl+K toggles the menu from anywhere.
 * - "/" opens the menu when the user is not already typing in an input.
 * - The legacy `nama:open-command` window event opens the menu, so the
 *   top-nav search button keeps working.
 *
 * The listener is attached once and reads `open` through a ref so the menu
 * opening / closing doesn't tear down and re-add the handler on every
 * toggle.
 */
export function useCommandMenuShortcuts(
  open: boolean,
  setOpen: (next: boolean | ((prev: boolean) => boolean)) => void,
): void {
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isToggleShortcut(event)) {
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (openRef.current || !isSlashShortcut(event)) return;
      event.preventDefault();
      setOpen(true);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [setOpen]);
}
