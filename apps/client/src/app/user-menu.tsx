import { Link, useRouter } from "@tanstack/react-router";
import { ChevronDown, Library, LogOut, Plug, Settings, Sparkles } from "lucide-react";
import { authClient } from "@/shared/lib/auth";
import { UserAvatar } from "@/shared/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Button } from "@/shared/ui/button";

export function UserMenu() {
  const router = useRouter();
  const session = authClient.useSession();
  const sessionUser = session.data?.user;
  const name = sessionUser?.name ?? "User";
  const email = sessionUser?.email ?? "";

  async function handleSignOut() {
    await authClient.signOut();
    void router.navigate({ to: "/auth/login" });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label="Account menu"
            variant="outline"
            size="sm"
            className={"cursor-pointer gap-1 rounded-full py-1 pl-1 pr-2 shadow-none"}
          >
            <UserAvatar name={name} email={email} size="sm" />
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <div className="border-b border-border px-3 py-2.5">
          <div className="text-sm font-medium text-foreground">{name}</div>
          <div className="text-xs text-muted-foreground">Personal · 4 sources</div>
        </div>
        <DropdownMenuItem render={<Link to="/settings" />}>
          <Settings className="size-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/settings/connections" />}>
          <Plug className="size-4" />
          Connections
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => {}}>
          <Sparkles className="size-4" />
          Taste
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => {}}>
          <Library className="size-4" />
          Watchlist
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleSignOut()}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
