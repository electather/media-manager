import { createFileRoute, redirect } from "@tanstack/react-router";

import { SettingsMobileNavList } from "@/app/settings-layout";

export const Route = createFileRoute("/_authenticated/_settings/settings/")({
  beforeLoad: () => {
    // On reload of /settings without a sub-page, the desktop layout already
    // shows a sidebar so a content column with no heading would look broken.
    // Redirect to /settings/profile by default. The mobile drill-down list
    // is only useful on narrow viewports, so we still render it client-side
    // when no sub-page is active.
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
      throw redirect({ to: "/settings/profile" });
    }
  },
  component: SettingsIndex,
});

function SettingsIndex() {
  return <SettingsMobileNavList />;
}
