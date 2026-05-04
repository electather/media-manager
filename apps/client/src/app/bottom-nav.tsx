import { Link } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import { NAV_ITEMS, useActiveNavIndex } from "./nav-items";

export function BottomNav() {
  const idx = useActiveNavIndex();
  const count = NAV_ITEMS.length;

  return (
    <nav
      aria-label={m.home_nav_label_mobile()}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="pointer-events-auto relative isolate w-full max-w-sm">
        {idx >= 0 && (
          <span
            aria-hidden="true"
            data-testid="nav-active-pill"
            className="pointer-events-none absolute border border-white/8 bg-white/14"
            style={{
              top: 6,
              bottom: 6,
              left: 6,
              width: `calc((100% - 12px) / ${count})`,
              borderRadius: 999,
              transform: `translateX(calc(${idx} * 100%))`,
              transition: "transform 300ms cubic-bezier(.2,.7,.2,1)",
            }}
          />
        )}
        <ul
          className="m-0 grid list-none grid-flow-col auto-cols-fr rounded-full bg-card/72 p-1.5"
          style={{
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            boxShadow: "var(--nav-frosted-shadow)",
          }}
        >
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
