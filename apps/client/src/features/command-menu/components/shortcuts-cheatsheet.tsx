import { useHotkeyRegistrations } from "@tanstack/react-hotkeys";
import { compact } from "es-toolkit/array";
import { useMemo } from "react";

import { m } from "@/paraglide/messages";
import { CommandGroup, CommandItem } from "@/shared/ui/command";
import { Kbd, KbdGroup } from "@/shared/ui/kbd";

import { formatHotkeyChips } from "../lib/format-hotkey-chips";

interface CheatsheetRow {
  id: string;
  label: string;
  description?: string;
  /** Pre-formatted keys ("⌘", "K") to render in `<Kbd>` chips. */
  chips: readonly string[];
}

/**
 * Drill-in panel rendered when the top frame is `{ kind: "cheatsheet" }`. The
 * list is sourced from `useHotkeyRegistrations` so adding a new hotkey row
 * anywhere in the tree shows up here automatically — there is no separate
 * help table to keep in sync.
 */
export function ShortcutsCheatsheet() {
  const { hotkeys, sequences } = useHotkeyRegistrations();

  // fallow-ignore-next-line complexity
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
        chips: formatHotkeyChips(reg.hotkey),
      };
      // `meta.group` is set at registration time in `use-command-hotkeys.ts`
      // — sorting on a structural discriminant survives translation,
      // unlike a regex over the localized `name` string.
      if (meta.group === "menu") menuKeys.push(row);
      else actionKeys.push(row);
    }
    // fallow-ignore-next-line complexity
    const sequenceRows: CheatsheetRow[] = compact(
      sequences.map((reg) => {
        if (!reg.options.meta?.name) return null;
        return {
          id: reg.id,
          label: reg.options.meta?.name ?? reg.sequence.join(" "),
          description: reg.options.meta?.description,
          chips: reg.sequence.flatMap((key, idx, arr) => {
            const chips = formatHotkeyChips(key);
            return idx < arr.length - 1 ? [...chips, "→"] : chips;
          }),
        };
      }),
    );
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
