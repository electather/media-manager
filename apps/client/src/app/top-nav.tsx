import { useScrolled } from "@/shared/hooks/use-scrolled";
import { CommandMenuTrigger } from "./command-menu-trigger";
import { NavBrand } from "./nav-brand";
import { NotificationPanel } from "./notification-panel";
import { TopNavLinks } from "./top-nav-links";
import { UserMenu } from "./user-menu";

export function TopNav() {
  const scrolled = useScrolled();

  return (
    <header
      data-scrolled={scrolled}
      className="sticky top-0 z-20 isolate flex justify-center border-b border-transparent bg-transparent transition-all duration-320 ease-[cubic-bezier(0.32,0.72,0,1)] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-28 before:bg-[linear-gradient(to_bottom,oklch(0_0_0/0.5),oklch(0_0_0/0.28)_42%,oklch(0_0_0/0.1)_72%,transparent)] before:content-[''] data-[scrolled=true]:px-6 data-[scrolled=true]:pt-2.5"
    >
      <div
        data-scrolled={scrolled}
        className="relative z-10 w-full max-w-350 rounded-none ring-1 ring-inset ring-transparent transition-all duration-320 ease-[cubic-bezier(0.32,0.72,0,1)] data-[scrolled=true]:rounded-lg data-[scrolled=true]:bg-card/45 data-[scrolled=true]:p-1 data-[scrolled=true]:shadow-[0_1px_0_0_rgb(255_255_255/0.03),0_8px_24px_-12px_rgb(0_0_0/0.5)] data-[scrolled=true]:ring-border/70 data-[scrolled=true]:backdrop-blur-[18px] data-[scrolled=true]:backdrop-saturate-[1.4]"
      >
        <div
          data-scrolled={scrolled}
          className="flex items-center justify-between gap-4 rounded-none bg-transparent px-6 py-5 transition-all duration-320 ease-[cubic-bezier(0.32,0.72,0,1)] data-[scrolled=true]:rounded-lg data-[scrolled=true]:bg-popover/45 data-[scrolled=true]:px-3.5 data-[scrolled=true]:py-2.5 data-[scrolled=true]:shadow-[0_1px_0_0_rgb(255_255_255/0.04),0_4px_12px_-6px_rgb(0_0_0/0.4)] data-[scrolled=true]:backdrop-blur-[14px] data-[scrolled=true]:backdrop-saturate-[1.3]"
        >
          <div className="flex items-center gap-2.5">
            <NavBrand scrolled={scrolled} />
            <div className="mx-1 hidden h-4 w-px bg-border md:block" />
            <TopNavLinks />
          </div>
          <div className="flex items-center gap-2.5">
            <CommandMenuTrigger />
            <NotificationPanel />
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
