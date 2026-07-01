import type { ReactNode } from "react";

import { CommandMenu } from "@/features/command-menu";

import { BottomNav } from "./bottom-nav";
import { TopNav } from "./top-nav";

/** Outer chrome shared by all authenticated shells: nav bars + command menu. */
export function ShellChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <TopNav />
      {children}
      <BottomNav />
      <CommandMenu />
    </div>
  );
}
