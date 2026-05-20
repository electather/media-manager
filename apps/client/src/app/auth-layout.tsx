import { Outlet } from "@tanstack/react-router";
import { PosterGridBackground } from "@/features/auth";
import { m } from "@/paraglide/messages";
import "../features/auth/auth.css";

export function AuthLayout() {
  return (
    <>
      <PosterGridBackground />
      <div className="veil" />
      <div className="vignette" />
      <div className="noise" />

      <div className="fixed inset-0 grid place-items-center z-10 p-6 overflow-y-auto max-sm:p-0 max-sm:flex max-sm:flex-col max-sm:justify-end">
        <div className="w-full max-w-[420px] frosted-glass border border-border rounded-2xl p-8 shadow-2xl space-y-6 flex flex-col max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:p-6 max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-col gap-1 items-center text-center">
            <div className="flex items-center gap-2 font-black tracking-widest text-primary text-sm font-sans uppercase">
              <span className="text-xl leading-none -translate-y-0.5">◐</span>
              <span>LUMEN</span>
            </div>
            <div className="text-[10px] tracking-widest text-muted-foreground uppercase font-mono">
              {m.auth_cinema_on_tap()}
            </div>
          </div>

          <Outlet />
        </div>
      </div>
    </>
  );
}
