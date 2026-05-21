import { Outlet } from "@tanstack/react-router";
import { Logo } from "@/shared/components/logo";
import { AuthOverlays } from "./components/auth-overlays";

export function AuthLayout() {
  return (
    <>
      <AuthOverlays />

      <div className="fixed inset-0 z-10 grid place-items-center overflow-y-auto p-6 max-sm:flex max-sm:flex-col max-sm:justify-end max-sm:p-0">
        <div className="frosted-glass w-full max-w-105 rounded-2xl p-1 max-sm:max-w-none max-sm:rounded-t-2xl max-sm:rounded-b-none">
          <div className="@container relative isolate flex flex-col space-y-6 rounded-[13px] bg-secondary/60 p-7 shadow-[0_1px_0_0_oklch(1_0_0/0.04),0_4px_12px_-6px_oklch(0_0_0/0.4)] backdrop-blur-[14px] backdrop-saturate-[1.3] max-sm:space-y-3 max-sm:rounded-t-[13px] max-sm:rounded-b-none max-sm:p-4 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div className="flex flex-col items-center gap-2 text-center">
              <Logo className="size-14 text-primary max-sm:size-10" />
            </div>

            <Outlet />
          </div>
        </div>
      </div>
    </>
  );
}
