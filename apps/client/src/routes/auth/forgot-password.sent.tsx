import { createFileRoute } from "@tanstack/react-router";
import { ForgotPasswordSent } from "@/features/auth";

export const Route = createFileRoute("/auth/forgot-password/sent")({
  component: ForgotPasswordSent,
});
