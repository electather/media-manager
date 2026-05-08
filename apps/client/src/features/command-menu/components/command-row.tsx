import { CornerDownLeft, type LucideIcon } from "lucide-react";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import type { ReactNode } from "react";

import { CommandShortcut } from "@/shared/ui/command";
import { Kbd, KbdGroup } from "@/shared/ui/kbd";

export function RowIcon({ Icon }: { Icon: LucideIcon }) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      <Icon className="size-3.5" />
    </div>
  );
}

export function RowContent({
  label,
  hint,
  badge,
  hotkey,
}: {
  label: string;
  hint: string;
  badge?: ReactNode;
  /** Renders a platform-formatted Kbd group beside the label. */
  hotkey?: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
        <span className="truncate">{label}</span>
        {badge}
        {hotkey && <RowHotkey hotkey={hotkey} />}
      </div>
      <div className="truncate text-xs text-muted-foreground/80">{hint}</div>
    </div>
  );
}

function RowHotkey({ hotkey }: { hotkey: string }) {
  const platform: "mac" | "windows" =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent)
      ? "mac"
      : "windows";
  const chips = formatForDisplay(hotkey, { platform })
    .split("+")
    .map((s: string) => s.trim())
    .filter(Boolean);
  return (
    <KbdGroup className="gap-1">
      {chips.map((chip, idx) => (
        <Kbd
          key={`${idx}:${chip}`}
          className="border border-border font-mono text-[10px] uppercase"
        >
          {chip}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

export function RowAffordance({ label }: { label: string }) {
  return (
    <CommandShortcut className="hidden items-center gap-1.5 text-[11px] text-muted-foreground/80 group-data-[selected=true]/command-item:flex">
      <span>{label}</span>
      <Kbd className="border border-border">
        <CornerDownLeft className="size-3" />
      </Kbd>
    </CommandShortcut>
  );
}
