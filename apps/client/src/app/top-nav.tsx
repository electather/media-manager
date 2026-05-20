import { NotificationBell } from "@/features/notifications";
import { useScrolled } from "@/shared/hooks/use-scrolled";
import { cn } from "@/shared/lib/utils";
import { CommandMenuTrigger } from "./command-menu-trigger";
import { NavBrand } from "./nav-brand";
import { TopNavLinks } from "./top-nav-links";
import { UserMenu } from "./user-menu";

const topNavMotionClassName = "transition-all duration-320 ease-[cubic-bezier(0.32,0.72,0,1)]";

const headerClassName = cn(
  "sticky top-0 z-20 isolate flex justify-center",
  "border-b border-transparent bg-transparent",
  topNavMotionClassName,
  "data-[scrolled=true]:px-6 data-[scrolled=true]:pt-2.5",
);

const navFrameClassName = cn(
  "relative z-10 w-full max-w-350 rounded-none",
  "border border-transparent",
  topNavMotionClassName,
  "data-[scrolled=true]:rounded-lg data-[scrolled=true]:frosted-glass data-[scrolled=true]:p-1",
);

const navSurfaceClassName = cn(
  "flex items-center justify-between gap-4",
  "rounded-none bg-transparent px-6 py-5",
  topNavMotionClassName,
  "data-[scrolled=true]:rounded-lg data-[scrolled=true]:bg-popover/45",
  "data-[scrolled=true]:px-3.5 data-[scrolled=true]:py-2.5",
  "data-[scrolled=true]:shadow-[0_1px_0_0_rgb(255_255_255/0.04),0_4px_12px_-6px_rgb(0_0_0/0.4)]",
  "data-[scrolled=true]:backdrop-blur-[14px] data-[scrolled=true]:backdrop-saturate-[1.3]",
);

const navClusterClassName = "flex items-center gap-2.5";

export function TopNav() {
  const scrolled = useScrolled();

  return (
    <header data-scrolled={scrolled} className={headerClassName}>
      <div data-scrolled={scrolled} className={navFrameClassName}>
        <div data-scrolled={scrolled} className={navSurfaceClassName}>
          <div className={navClusterClassName}>
            <NavBrand scrolled={scrolled} />
            <div className="mx-1 hidden h-4 w-px bg-border md:block" />
            <TopNavLinks />
          </div>
          <div className={navClusterClassName}>
            <CommandMenuTrigger />
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
