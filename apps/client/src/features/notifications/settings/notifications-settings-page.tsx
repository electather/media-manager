import { Suspense } from "react";
import { m } from "@/paraglide/messages";
import { ChannelsSection } from "./channels-section";
import { SettingsSkeleton } from "./settings-skeleton";
import { SubscriptionsMatrix } from "./subscriptions-matrix";

export function NotificationsSettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{m.notifications_title()}</h1>
      </header>
      <Suspense fallback={<SettingsSkeleton />}>
        <ChannelsSection />
      </Suspense>
      <Suspense fallback={<SettingsSkeleton />}>
        <SubscriptionsMatrix />
      </Suspense>
    </div>
  );
}
