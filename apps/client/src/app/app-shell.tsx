import { Outlet } from "@tanstack/react-router";
import { BottomNav } from "./bottom-nav";
import { TopNav } from "./top-nav";

export function AppShell() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <TopNav />
      <main className="flex-1">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
