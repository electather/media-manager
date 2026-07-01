import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CommandMenu } from "@/features/command-menu";
import { BottomNav } from "./bottom-nav";
import { TopNav } from "./top-nav";

export function AppShell({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <TopNav />
      <main className="flex-1">{children ?? <Outlet />}</main>
      <BottomNav />
      <CommandMenu />
    </div>
  );
}
