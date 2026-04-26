import { Link, useRouter } from "@tanstack/react-router";
import { LogOutIcon, Settings2Icon } from "lucide-react";
import { authClient } from "@/lib/auth";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
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
        render={
          <button
            type="button"
            aria-label="Open profile menu"
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <UserAvatar name={user.name} email={user.email} className="size-9" />
          </button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-56">
        <DropdownMenuGroup>
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
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link to="/admin/jobs" />}>
          <Settings2Icon />
          Admin
          <DropdownMenuShortcut>⇧⌘,</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/settings" />}>
          <Settings2Icon />
          Settings
          <DropdownMenuShortcut>⌘.</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleSignOut()}>
          <LogOutIcon />
          Log out
          <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
