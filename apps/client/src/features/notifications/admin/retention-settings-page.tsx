import { Suspense } from "react";
import { Skeleton } from "@/shared/ui/skeleton";
import { m } from "@/paraglide/messages";
import { RetentionForm } from "./retention-form";

export function RetentionSettingsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{m.notifications_admin_settings_title()}</h1>
      </header>
      <Suspense fallback={<Skeleton className="h-48 w-full max-w-md" />}>
        <RetentionForm />
      </Suspense>
    </div>
  );
}
