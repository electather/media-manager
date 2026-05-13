import {
  type Hotkey,
  type HotkeySequence,
  type UseHotkeyDefinition,
  type UseHotkeySequenceDefinition,
  useHotkey,
  useHotkeySequences,
  useHotkeys,
} from "@tanstack/react-hotkeys";
import { useNavigate } from "@tanstack/react-router";
import { compact } from "es-toolkit/array";
import { useEffect, useMemo } from "react";

import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";

import { COMMAND_PAGES } from "../registry/pages";
import { t } from "../lib/i18n";
import type { Contribution } from "../types";

// Custom-event opener fired by the top-nav search button. Kept on its current
// literal so the trigger button stays decoupled from this hook.
const OPEN_EVENT = "nama:open-command";

/**
 * Extends the TanStack Hotkeys metadata bag with a `group` discriminant so
 * the cheatsheet can sort registrations structurally instead of regexing the
 * localized name string. Declaration merging is the documented extension
 * point — see `@tanstack/hotkeys` `HotkeyMeta` JSDoc.
 */
declare module "@tanstack/react-hotkeys" {
  interface HotkeyMeta {
    /** Cheatsheet section the registration belongs in. */
    group?: "menu" | "navigate" | "action";
  }
}

interface UseCommandHotkeysInput {
  open: boolean;
  setOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  /** Contributions whose `hotkey` should fire whenever the menu is open. */
  contributions: readonly Contribution[];
  /** Run a contribution's row handler — called by per-row hotkey callbacks. */
  runContribution: (item: Contribution) => void;
}

type HotkeyContribution = Contribution & { hotkey: string };

/**
 * Single owner of every menu-related keyboard binding. Replaces the previous
 * `window.addEventListener("keydown", …)` glue with TanStack Hotkeys so
 * registrations carry `meta` for the cheatsheet and use cross-platform `Mod`.
 */
export function useCommandHotkeys({
  open,
  setOpen,
  contributions,
  runContribution,
}: UseCommandHotkeysInput): void {
  // Mod+K toggles the menu from anywhere — the canonical command-bar binding.
  useHotkey("Mod+K", () => setOpen((prev) => !prev), {
    meta: {
      name: m.hotkey_toggle_menu_name(),
      description: m.hotkey_toggle_menu_desc(),
      group: "menu",
    },
  });

  // Slash opens the menu, but only when the user is not typing in a field.
  // `ignoreInputs: true` is the smart default for single-key bindings.
  useHotkey("/", () => setOpen(true), {
    enabled: !open,
    ignoreInputs: true,
    meta: {
      name: m.hotkey_open_menu_name(),
      description: m.hotkey_open_menu_desc(),
      group: "menu",
    },
  });

  // Esc handling lives on the `Dialog` `onOpenChange` interceptor in
  // `command-menu.tsx` — Base-UI fires `escapeKey` there and lets us pop a
  // frame instead of closing the dialog when we're below root. We register
  // an `enabled: false` row here purely to keep the cheatsheet listing
  // accurate.
  useHotkey("Escape", () => {}, {
    enabled: false,
    meta: {
      name: m.hotkey_close_menu_name(),
      description: m.hotkey_close_menu_desc(),
      group: "menu",
    },
  });

  // Page sequences (`g h`, `g l`, …) are only useful while the menu is closed
  // — typing into the cmdk input must not arm a sequence.
  const navigate = useNavigate();
  // Non-reactive read; including it in `useMemo` deps re-builds meta strings
  // when the user hot-swaps locale via the menu's settings entry.
  const locale = getLocale();
  const pageSequences = useMemo<UseHotkeySequenceDefinition[]>(
    () =>
      compact(
        COMMAND_PAGES.map((page) => {
          if (!page.sequence || page.sequence.length === 0) return null;
          return {
            sequence: [...page.sequence] as HotkeySequence,
            callback: () => {
              void navigate({ to: page.to });
            },
            options: {
              enabled: !open,
              meta: {
                name: t(page.labelKey),
                description: t(page.hintKey),
                group: "navigate",
              },
            },
          };
        }),
      ),
    [navigate, open, locale],
  );
  useHotkeySequences(pageSequences);

  // Per-row hotkeys for any contribution that declares one. Memoizing the
  // dynamic array keeps the hotkey registrations stable between renders.
  const contributionHotkeys = useMemo<UseHotkeyDefinition[]>(
    () =>
      compact(
        contributions.map((contribution) => {
          if (!contribution.hotkey) return null;
          const hotkeyContribution = contribution as HotkeyContribution;
          return {
            hotkey: hotkeyContribution.hotkey as Hotkey,
            callback: () => runContribution(hotkeyContribution),
            options: {
              enabled: open,
              meta: {
                name: t(hotkeyContribution.labelKey),
                description: t(hotkeyContribution.hintKey),
                group: "action",
              },
            },
          };
        }),
      ),
    [contributions, open, runContribution, locale],
  );
  useHotkeys(contributionHotkeys);

  // Legacy window event used by `CommandMenuTrigger` so the search button in
  // the top nav keeps opening the menu without coupling to the hotkey lib.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [setOpen]);
}
