import { Link } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import { NAV_ITEMS, useActiveNavIndex } from "./nav-items";
import { NavPill } from "./nav-pill";

export function BottomNav() {
  const idx = useActiveNavIndex();

  return (
    <nav
      aria-label={m.home_nav_label_mobile()}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="pointer-events-auto relative isolate w-full max-w-sm">
        {idx >= 0 && (
          <NavPill
            className="top-1.5 right-1.5 bottom-1.5 left-1.5 w-[calc((100%-12px)/3)] rounded-full transition-transform duration-300 ease-[cubic-bezier(.2,.7,.2,1)]"
            style={{ transform: `translateX(calc(${idx} * 100%))` }}
          />
        )}
        <ul className="m-0 grid list-none grid-flow-col auto-cols-fr rounded-full bg-card/72 p-1.5 shadow-[var(--nav-frosted-shadow)] backdrop-blur-[20px] backdrop-saturate-[1.8]">
          {NAV_ITEMS.map(({ to, label, Icon, activeOptions }) => (
            <li key={to} className="flex">
              <Link
                to={to}
                activeOptions={activeOptions}
                activeProps={{ "aria-current": "page" as const }}
                className="relative z-10 flex w-full items-center justify-center gap-2 rounded-full px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-colors duration-150 data-[status=active]:text-foreground"
              >
                <Icon className="size-5" />
                <span>{label()}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
