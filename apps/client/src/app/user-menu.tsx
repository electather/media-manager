import { Link, useRouter } from "@tanstack/react-router";
import { ChevronDown, Library, LogOut, Plug, Settings, ShieldCheck } from "lucide-react";
import * as m from "@/paraglide/messages";
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
import { cn } from "@/shared/lib/utils";

// fallow-ignore-next-line complexity
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
            aria-label={m.home_user_menu_label()}
            variant="outline"
            size="sm"
            className={cn("cursor-pointer gap-1 rounded-full py-1 ps-1 pe-2")}
          >
            <UserAvatar name={name} email={email} size="sm" />
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <DropdownMenuItem render={<Link to="/settings" />}>
          <Settings className="size-4" />
          {m.settings_title()}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/admin" />}>
          <ShieldCheck className="size-4" />
          {m.admin_title()}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/settings/connections" />}>
          <Plug className="size-4" />
          {m.settings_connections_title()}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link to="/watchlist" />}>
          <Library className="size-4" />
          {m.watchlist_title()}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleSignOut()}>
          <LogOut className="size-4" />
          {m.home_user_menu_sign_out()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
