import { Button } from "@/components/ui/button";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Settings</h1>
      <p className="text-muted-foreground">Configure integrations and preferences</p>
      <Button className="mt-4" onClick={() => alert("Settings saved!")}>
        Save Settings
      </Button>
    </div>
  );
}
