import { Outlet } from "@tanstack/react-router";
import { m } from "@/paraglide/messages";
import { AuthOverlays } from "./components/auth-overlays";

export function AuthLayout() {
  return (
    <>
      <AuthOverlays />

      <div className="fixed inset-0 z-10 grid place-items-center overflow-y-auto p-6 max-sm:flex max-sm:flex-col max-sm:justify-end max-sm:p-0">
        <div className="frosted-glass flex w-full max-w-[420px] flex-col space-y-6 rounded-2xl p-8 shadow-2xl max-sm:max-w-none max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:p-6 max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-col items-center gap-1 text-center">
            <div className="flex items-center gap-2 font-sans text-sm font-black tracking-widest text-primary uppercase">
              <span className="-translate-y-0.5 text-xl leading-none">◐</span>
              <span>LUMEN</span>
            </div>
            <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              {m.auth_cinema_on_tap()}
            </div>
          </div>

          <Outlet />
        </div>
      </div>
    </>
  );
}
