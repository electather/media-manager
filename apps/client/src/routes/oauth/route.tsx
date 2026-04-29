import { AuthLayout } from "@/app/auth-layout";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/oauth")({
  component: AuthLayout,
});
