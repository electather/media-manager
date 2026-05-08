import { formatForDisplay, useHotkeyRegistrations } from "@tanstack/react-hotkeys";
import { useMemo } from "react";

import { m } from "@/paraglide/messages";
import { CommandGroup, CommandItem } from "@/shared/ui/command";
import { Kbd, KbdGroup } from "@/shared/ui/kbd";

interface CheatsheetRow {
  id: string;
  label: string;
  description?: string;
  /** Pre-formatted keys ("⌘", "K") to render in `<Kbd>` chips. */
  chips: readonly string[];
}

function platform(): "mac" | "windows" {
  if (typeof navigator === "undefined") return "windows";
  return /mac|iphone|ipad|ipod/i.test(navigator.userAgent) ? "mac" : "windows";
}

function formatChips(hotkey: string): string[] {
  // `formatForDisplay` returns the platform-canonical string ("⌘+K" on mac).
  // Split on "+" so we can render each modifier as its own `<Kbd>` chip.
  const display = formatForDisplay(hotkey, { platform: platform() });
  return display
    .split("+")
    .map((s: string) => s.trim())
    .filter(Boolean);
}

/**
 * Drill-in panel rendered when the top frame is `{ kind: "cheatsheet" }`. The
 * list is sourced from `useHotkeyRegistrations` so adding a new hotkey row
 * anywhere in the tree shows up here automatically — there is no separate
 * help table to keep in sync.
 */
export function ShortcutsCheatsheet() {
  const { hotkeys, sequences } = useHotkeyRegistrations();

  const groups = useMemo(() => {
    const menuKeys: CheatsheetRow[] = [];
    const actionKeys: CheatsheetRow[] = [];
    for (const reg of hotkeys) {
      const meta = reg.options.meta;
      if (!meta?.name) continue;
      const row: CheatsheetRow = {
        id: reg.id,
        label: meta.name,
        description: meta.description,
        chips: formatChips(reg.hotkey),
      };
      // Globals (toggle, open, close) sort under "Menu" by convention; every
      // other registration is treated as an in-menu action.
      if (/menu|cheatsheet|close/i.test(meta.name)) menuKeys.push(row);
      else actionKeys.push(row);
    }
    const sequenceRows: CheatsheetRow[] = sequences
      .filter((reg) => reg.options.meta?.name)
      .map((reg) => ({
        id: reg.id,
        label: reg.options.meta?.name ?? reg.sequence.join(" "),
        description: reg.options.meta?.description,
        chips: reg.sequence.flatMap((key, idx, arr) => {
          const chips = formatChips(key);
          return idx < arr.length - 1 ? [...chips, "→"] : chips;
        }),
      }));
    return { menuKeys, actionKeys, sequenceRows };
  }, [hotkeys, sequences]);

  return (
    <>
      {groups.menuKeys.length > 0 && (
        <CommandGroup heading={m.command_menu_section_shortcuts_menu()}>
          {groups.menuKeys.map((row) => (
            <CheatsheetItem key={row.id} row={row} />
          ))}
        </CommandGroup>
      )}
      {groups.sequenceRows.length > 0 && (
        <CommandGroup heading={m.command_menu_section_shortcuts_navigate()}>
          {groups.sequenceRows.map((row) => (
            <CheatsheetItem key={row.id} row={row} />
          ))}
        </CommandGroup>
      )}
      {groups.actionKeys.length > 0 && (
        <CommandGroup heading={m.command_menu_section_shortcuts_actions()}>
          {groups.actionKeys.map((row) => (
            <CheatsheetItem key={row.id} row={row} />
          ))}
        </CommandGroup>
      )}
    </>
  );
}

function CheatsheetItem({ row }: { row: CheatsheetRow }) {
  return (
    <CommandItem value={`${row.id} ${row.label} ${row.description ?? ""}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="truncate text-sm font-medium text-foreground">{row.label}</div>
        {row.description && (
          <div className="truncate text-xs text-muted-foreground/80">{row.description}</div>
        )}
      </div>
      <KbdGroup className="gap-1">
        {row.chips.map((chip, idx) => (
          <Kbd
            key={`${row.id}:${idx}:${chip}`}
            className="border border-border font-mono text-[10px] uppercase"
          >
            {chip}
          </Kbd>
        ))}
      </KbdGroup>
    </CommandItem>
  );
}
