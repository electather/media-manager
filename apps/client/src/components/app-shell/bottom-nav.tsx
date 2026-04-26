import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { APP_NAV_ITEMS } from "./nav-items";

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      {APP_NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = item.matchPrefix
          ? pathname === item.to || pathname.startsWith(`${item.to}/`)
          : pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
            <span>{item.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
