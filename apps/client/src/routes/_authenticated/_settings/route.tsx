import { createFileRoute } from "@tanstack/react-router";
import { SettingsLayout } from "@/app/settings-layout";

export const Route = createFileRoute("/_authenticated/_settings")({
  component: SettingsLayout,
});
