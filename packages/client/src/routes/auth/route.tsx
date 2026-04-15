import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/auth")({
  beforeLoad: async () => {
    try {
      const { data: session } = await authClient.getSession();
      if (session) {
        throw redirect({ to: "/dashboard" });
      }
    } catch (err) {
      // Re-throw TanStack Router redirects; swallow network/parse errors so
      // the auth pages still render when the backend is unavailable.
      if (isRedirect(err)) throw err;
    }
  },
  component: AuthLayout,
});

/** Centered page shell used by all authentication routes. */
export default function AuthLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <Outlet />
      </div>
    </div>
  );
}
