import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/auth/invite/$token")({
  component: InvitePage,
});

function InvitePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Accept Invitation</h1>
        <p className="text-muted-foreground mt-2">
          Validates the invite token, then presents a registration form to create an account.
          Redirects to the onboarding wizard at /setup on success.
        </p>
      </div>
    </div>
  );
}
