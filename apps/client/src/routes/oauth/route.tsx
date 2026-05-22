import { createFileRoute } from "@tanstack/react-router";
import { AuthLayout } from "@/features/auth";

export const Route = createFileRoute("/oauth")({
  component: AuthLayout,
});
