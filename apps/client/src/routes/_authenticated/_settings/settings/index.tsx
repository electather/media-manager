import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_settings/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/profile" });
  },
});
