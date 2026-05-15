import { Check } from "lucide-react";
import { toast } from "sonner";

import { m } from "@/paraglide/messages";
import { CommandGroup, CommandItem } from "@/shared/ui/command";

import { settingMatchValue } from "../lib/match-values";
import type { SettingItem } from "../types";
import { RowAffordance, RowIcon } from "./command-row";

interface SettingDrillProps<T extends string> {
  setting: SettingItem<T>;
  /** Pop the drill frame after a successful write. */
  onPop: () => void;
}

/**
 * Generic drill-in panel for any `SettingItem<T>`. The current value is
 * marked with a checkmark and the row affordance flips to a check icon so
 * keyboard users still see something to confirm.
 */
export function SettingDrill<T extends string>({ setting, onPop }: SettingDrillProps<T>) {
  const current = setting.read();
  return (
    <CommandGroup heading={m[setting.labelKey]()}>
      {setting.options.map((opt) => {
        const isCurrent = opt.id === current;
        return (
          <CommandItem
            key={opt.id}
            value={settingMatchValue(setting, opt)}
            onSelect={() => {
              // Spec §11: a thrown `write` keeps the drill open and surfaces
              // an error toast. The success toast / pop only fire on the
              // happy path so a failed save never appears confirmed.
              try {
                setting.write(opt.id);
              } catch {
                toast.error(m.command_menu_setting_write_error());
                return;
              }
              if (setting.toastKey) toast.success(m[setting.toastKey]());
              onPop();
            }}
          >
            {opt.Icon ? (
              <RowIcon Icon={opt.Icon} />
            ) : (
              <span className="flex size-8 shrink-0 items-center justify-center" aria-hidden />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
                <span className="truncate">{m[opt.labelKey]()}</span>
                {isCurrent && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
              </div>
              {opt.hintKey && (
                <div className="truncate text-xs text-muted-foreground/80">{m[opt.hintKey]()}</div>
              )}
            </div>
            {!isCurrent && <RowAffordance label={m.command_menu_action_open()} />}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
