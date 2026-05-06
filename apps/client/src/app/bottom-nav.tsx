import * as m from "@/paraglide/messages";
import { NAV_ITEMS, useActiveNavIndex } from "./nav-items";
import { NavLink } from "./nav-link";
import { NavPill } from "./nav-pill";

export function BottomNav() {
  const idx = useActiveNavIndex();

  return (
    <nav
      aria-label={m.home_nav_label_mobile()}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-7 pb-[max(1rem,env(safe-area-inset-bottom))] transition-[transform,opacity] duration-300 ease-[cubic-bezier(.2,.7,.2,1)] md:hidden"
    >
      <div className="pointer-events-auto w-full max-w-120 rounded-[14px] bg-card/90 p-1 shadow-(--nav-frosted-shadow) ring-1 ring-inset ring-border">
        <div className="@container relative isolate rounded-[11px] bg-secondary/85 p-1.5 shadow-[0_1px_0_0_oklch(1_0_0/0.04),0_4px_12px_-6px_oklch(0_0_0/0.4)]">
          {idx >= 0 && (
            <NavPill
              className="top-1.5 right-1.5 bottom-1.5 left-1.5 w-[calc((100%-12px)/3)] rounded-lg border-white/10 bg-foreground/15 transition-transform duration-300 ease-[cubic-bezier(.2,.7,.2,1)]"
              style={{ transform: `translateX(calc(${idx} * 100%))` }}
            />
          )}
          <ul className="m-0 grid list-none grid-flow-col auto-cols-fr">
            {NAV_ITEMS.map(({ to, label, Icon, activeOptions }) => (
              <li key={to} className="flex">
                <NavLink
                  to={to}
                  activeOptions={activeOptions}
                  className="w-full flex-col gap-1 rounded-lg px-2 py-1.5 text-xs text-muted-foreground @sm:flex-row @sm:gap-2 @sm:px-3.5 @sm:py-2.5 @sm:text-sm"
                >
                  <Icon aria-hidden="true" className="size-5" />
                  <span>{label()}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  );
}
