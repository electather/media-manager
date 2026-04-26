import { Link, Outlet } from "@tanstack/react-router";
import { XIcon, TvIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SettingsLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <TvIcon className="size-5" aria-hidden="true" />
          <span>Media Manager</span>
        </Link>
        <Button variant="ghost" size="sm" aria-label="Close settings" render={<Link to="/" />}>
          <XIcon className="size-4" aria-hidden="true" />
          Close
        </Button>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
