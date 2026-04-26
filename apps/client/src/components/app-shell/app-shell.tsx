import { Link, Outlet } from "@tanstack/react-router";
import { TvIcon } from "lucide-react";
import { authClient } from "@/lib/auth";
import { BottomNav } from "./bottom-nav";
import { ProfileDropdown, type ProfileDropdownUser } from "./profile-dropdown";

export function AppShell() {
  const session = authClient.useSession();
  const sessionUser = session.data?.user;
  const user: ProfileDropdownUser = {
    name: sessionUser?.name ?? "User",
    email: sessionUser?.email ?? "",
  };

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <TvIcon className="size-5" aria-hidden="true" />
          <span>Media Manager</span>
        </Link>
        <ProfileDropdown user={user} />
      </header>
      <main className="flex-1 pb-20">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
