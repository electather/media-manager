import { createFileRoute, redirect } from "@tanstack/react-router";
import { BootstrapPage, publicConfigQueryOptions } from "@/features/onboarding";

export const Route = createFileRoute("/bootstrap")({
  beforeLoad: async ({ context: { queryClient } }) => {
    // Fail open if the backend is unreachable (cfg = null): show the bootstrap
    // page rather than crash, since the claim endpoint is server-authoritative
    // and rejects with `already_completed` if the server is in fact set up.
    const cfg = await queryClient.ensureQueryData(publicConfigQueryOptions()).catch(() => null);
    // The server is already set up, so there is nothing to bootstrap; send the operator to sign in.
    if (cfg && !cfg.needsBootstrap) throw redirect({ to: "/auth/login" });
  },
  component: BootstrapPage,
});
