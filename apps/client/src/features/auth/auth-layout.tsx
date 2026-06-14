import { Outlet } from "@tanstack/react-router";
import { AuthShell } from "./components/auth-shell";

export function AuthLayout() {
  return (
    <AuthShell>
      <Outlet />
    </AuthShell>
  );
}
