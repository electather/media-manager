import { createFileRoute } from "@tanstack/react-router";

import { SettingsAppsRoute, settingsAppsPageQueryOptions } from "@/features/settings-apps";

export const Route = createFileRoute("/_authenticated/_settings/settings/apps")({
  loader: ({ context: { queryClient } }) => {
    const [publicConfigOptions, authorizedAppsOptions] = settingsAppsPageQueryOptions();
    return Promise.all([
      queryClient.ensureQueryData(publicConfigOptions),
      queryClient.ensureQueryData(authorizedAppsOptions),
    ]);
  },
  component: SettingsAppsRoute,
});
