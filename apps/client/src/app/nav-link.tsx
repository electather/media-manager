import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import type { NavItem } from "./nav-items";

type Props = {
  to: NavItem["to"];
  activeOptions?: NavItem["activeOptions"];
  className?: string;
  children: ReactNode;
};

/**
 * Shared base for top-nav and bottom-nav links. Handles the TanStack Router
 * `activeProps`/`aria-current` wiring and the active text-color transition;
 * shape, padding, and resting color are passed in by the consumer.
 */
export function NavLink({ to, activeOptions, className, children }: Props) {
  return (
    <Link
      to={to}
      activeOptions={activeOptions}
      activeProps={{ "aria-current": "page" as const }}
      className={cn(
        "relative z-10 flex items-center justify-center text-sm font-medium transition-colors duration-150 data-[status=active]:text-foreground",
        className,
      )}
    >
      {children}
    </Link>
  );
}
