import { Suspense, useState } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/app/settings-layout";
import { SettingsCard, SettingsCardHeader } from "@/features/settings";

import {
  NotificationsErrorBoundary,
  NotificationsErrorFallback,
} from "@/features/notifications/shared/error-boundary";
import { SettingsNotificationsChannels } from "./settings-notifications-channels";
import { SettingsSkeleton } from "./settings-skeleton";

export { NotificationsErrorFallback as SettingsNotificationsRouteErrorFallback };

export function SettingsNotificationsRoute() {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <NotificationsErrorBoundary>
      <div className="flex flex-col gap-7">
        <SettingsPageHeader
          title={m.settings_notifications_title()}
          description={m.settings_notifications_description()}
        />
        <SettingsCard>
          <SettingsCardHeader
            title={m.settings_notifications_channels_title()}
            description={m.settings_notifications_channels_description()}
            action={
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <PlusIcon className="size-3.5" />
                {m.settings_notifications_channels_add()}
              </Button>
            }
          />
          <Suspense fallback={<SettingsSkeleton />}>
            <SettingsNotificationsChannels addOpen={addOpen} setAddOpen={setAddOpen} />
          </Suspense>
        </SettingsCard>
      </div>
    </NotificationsErrorBoundary>
  );
}
