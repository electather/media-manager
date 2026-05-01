import { useState } from "react";
import { Bookmark, Home, Library, Search, type LucideIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";

type NavItemId = "home" | "search" | "library" | "watchlist";

interface NavItem {
  id: NavItemId;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "library", label: "Library", icon: Library },
  { id: "watchlist", label: "Watchlist", icon: Bookmark },
];

interface BottomNavProps {
  active?: NavItemId;
  onChange?: (id: NavItemId) => void;
}

export function BottomNav({ active = "home", onChange }: BottomNavProps) {
  const [current, setCurrent] = useState<NavItemId>(active);
  const idx = Math.max(
    0,
    NAV_ITEMS.findIndex((item) => item.id === current),
  );

  function handleSelect(id: NavItemId) {
    setCurrent(id);
    onChange?.(id);
  }

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]"
    >
      <div
        className={cn(
          "relative pointer-events-auto w-full max-w-120",
          "p-1 rounded-xl",
          "bg-card/55 backdrop-blur-[18px] backdrop-saturate-[1.4]",
          "shadow-[0_1px_0_0_rgb(255_255_255/0.03),0_8px_24px_-12px_rgb(0_0_0/0.5),0_16px_40px_-8px_rgb(0_0_0/0.55)]",
          "ring-1 ring-inset ring-border",
        )}
      >
        <ul
          className={cn(
            "relative m-0 list-none isolate",
            "grid grid-flow-col auto-cols-fr",
            "p-1.5 rounded-lg",
            "bg-secondary/60 backdrop-blur-[14px] backdrop-saturate-[1.3]",
            "shadow-[0_1px_0_0_rgb(255_255_255/0.04),0_4px_12px_-6px_rgb(0_0_0/0.4)]",
          )}
        >
          <span
            aria-hidden="true"
            className="absolute top-1.5 bottom-1.5 left-1.5 z-0 w-[calc((100%-0.75rem)/4)] rounded-lg bg-foreground/[0.14] border border-foreground/[0.08] transition-transform duration-300 ease-[cubic-bezier(.2,.7,.2,1)]"
            style={{ transform: `translateX(calc(${idx} * 100%))` }}
          />
          {NAV_ITEMS.map((item) => {
            const isActive = item.id === current;
            const Icon = item.icon;
            return (
              <li key={item.id} className="flex">
                <button
                  type="button"
                  onClick={() => handleSelect(item.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative z-[1] flex w-full items-center justify-center gap-2",
                    "px-3.5 py-2.5 rounded-lg",
                    "border-none bg-transparent cursor-pointer",
                    "text-[13px] font-medium",
                    "transition-[color,transform] duration-150 ease-in active:scale-[0.97]",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
