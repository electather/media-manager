import { Suspense, useMemo } from "react";

import { Skeleton } from "@/shared/ui/skeleton";
import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";
import { SettingsPageHeader } from "@/shared/components/settings-page-header";
import { authClient } from "@/shared/lib/auth";
import { m } from "@/paraglide/messages";

import { settingsSecurityKeys } from "../lib/query-keys";
import type { DisplaySession } from "../lib/types";
import { useSessions } from "../hooks/use-sessions";
import { ChangePasswordCard } from "./change-password/change-password-card";
import { ActiveSessionsCard } from "./sessions/active-sessions-card";

export function SettingsSecurityRoute() {
  return (
    <SettingsErrorBoundary>
      <SecurityPage />
    </SettingsErrorBoundary>
  );
}

function SecurityPage() {
  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_security_title()}
        description={m.settings_security_description()}
      />
      <ChangePasswordCard />
      <SettingsErrorBoundary resetQueryKey={settingsSecurityKeys.sessions()}>
        <Suspense fallback={<Skeleton className="h-48 w-full rounded-2xl" />}>
          <SessionsSection />
        </Suspense>
      </SettingsErrorBoundary>
    </div>
  );
}

function SessionsSection() {
  const sessions = useSessions();
  const session = authClient.useSession();
  const currentSessionId = session.data?.session.id ?? null;

  const list: DisplaySession[] = useMemo(
    () => sessions.data.map((s) => ({ ...s, current: s.id === currentSessionId })),
    [sessions.data, currentSessionId],
  );

  if (!session.data) return <Skeleton className="h-48 w-full rounded-2xl" />;

  return <ActiveSessionsCard sessions={list} />;
}
