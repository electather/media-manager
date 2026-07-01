import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ShellChrome } from "./shell-chrome";

export function AppShell({ children }: { children?: ReactNode }) {
  return (
    <ShellChrome>
      <main className="flex-1">{children ?? <Outlet />}</main>
    </ShellChrome>
  );
}
