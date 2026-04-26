import { Link, useRouter } from "@tanstack/react-router";
import { LogOutIcon, Settings2Icon } from "lucide-react";
import { authClient } from "@/lib/auth";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ProfileDropdownUser {
  name: string;
  email: string;
}

export function ProfileDropdown({ user }: { user: ProfileDropdownUser }) {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    void router.navigate({ to: "/auth/login" });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open profile menu"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <UserAvatar name={user.name} email={user.email} className="size-9" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <UserAvatar name={user.name} email={user.email} />
            <div className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              {user.email && (
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              )}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/settings" />}>
          <Settings2Icon />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleSignOut()}>
          <LogOutIcon />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
