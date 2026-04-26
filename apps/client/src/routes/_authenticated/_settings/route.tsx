import { createFileRoute } from "@tanstack/react-router";
import { SettingsLayout } from "@/components/settings/settings-layout";

export const Route = createFileRoute("/_authenticated/_settings")({
  component: SettingsLayout,
});
