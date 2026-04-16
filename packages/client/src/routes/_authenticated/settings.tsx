import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-muted-foreground">
        Personal account settings. Sections: Account (change password, update email, manage
        sessions), MCP Connection (endpoint URL, regenerate auth tokens, connected MCP clients),
        Notifications (future placeholder), and Danger Zone (delete account with confirmation).
      </p>
    </div>
  );
}
