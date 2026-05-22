import { Link } from "@tanstack/react-router";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";

export function ForgotPasswordSent() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-center font-serif text-2xl font-bold tracking-tight text-foreground">
        {m.auth_reset_password()}
      </h1>
      <div className="space-y-4 py-4 text-center text-sm text-muted-foreground">
        <p>{m.auth_check_inbox()}</p>
        <Button variant="link" size="sm" render={<Link to="/auth/login" />}>
          {m.auth_back_to_login()}
        </Button>
      </div>
    </div>
  );
}
