import { createFileRoute, Link } from "@tanstack/react-router";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";

export const Route = createFileRoute("/auth/register")({
  component: InviteOnly,
});

// Public self-registration is disabled in v1; new accounts are created by an administrator.
// The deferred invite flow will replace this notice. This renders inside AuthLayout's Outlet,
// so it mirrors the auth card content structure.
function InviteOnly() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-center font-serif text-2xl font-bold tracking-tight text-foreground">
        {m.auth_register_invite_only_title()}
      </h1>
      <div className="space-y-4 py-4 text-center text-sm text-muted-foreground">
        <p>{m.auth_register_invite_only_body()}</p>
        <Button variant="link" size="sm" render={<Link to="/auth/login" />}>
          {m.auth_register_go_to_login()}
        </Button>
      </div>
    </div>
  );
}
