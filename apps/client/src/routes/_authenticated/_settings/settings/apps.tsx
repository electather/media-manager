import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, LayersIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/shared/ui/input-group";
import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";
import { useCopyFeedback } from "@/shared/hooks/use-copy-feedback";
import { relativeTime } from "@/shared/lib/relative-time";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/app/settings-layout";
import { SettingsCard, SettingsCardHeader, SettingsCardRow } from "@/features/settings";
import { MOCK_AUTHORIZED_APPS, type MockAuthorizedApp } from "@/features/settings/mocks";

export const Route = createFileRoute("/_authenticated/_settings/settings/apps")({
  component: AppsRoute,
});

function AppsRoute() {
  return (
    <SettingsErrorBoundary>
      <AppsPage />
    </SettingsErrorBoundary>
  );
}

function AppsPage() {
  const [apps, setApps] = useState<ReadonlyArray<MockAuthorizedApp>>(MOCK_AUTHORIZED_APPS);
  const [confirmRevoke, setConfirmRevoke] = useState<MockAuthorizedApp | null>(null);

  const handleRevoke = () => {
    if (!confirmRevoke) return;
    setApps((list) => list.filter((a) => a.clientId !== confirmRevoke.clientId));
    toast.success(m.settings_apps_toast_revoked({ name: confirmRevoke.name }));
    setConfirmRevoke(null);
  };

  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_apps_title()}
        description={m.settings_apps_description()}
      />

      <McpEndpointCard />

      <SettingsCard>
        <SettingsCardHeader title={m.settings_apps_authorized_title()} count={apps.length} />
        {apps.length === 0 ? (
          <AppsEmpty />
        ) : (
          <ul role="list" className="flex flex-col">
            {apps.map((app, i) => (
              <AppRow
                key={app.clientId}
                app={app}
                isFirst={i === 0}
                onRevoke={() => setConfirmRevoke(app)}
              />
            ))}
          </ul>
        )}
      </SettingsCard>

      <Dialog
        open={!!confirmRevoke}
        onOpenChange={(o) => {
          if (!o) setConfirmRevoke(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmRevoke
                ? m.settings_apps_revoke_dialog_title({ name: confirmRevoke.name })
                : ""}
            </DialogTitle>
            <DialogDescription>{m.settings_apps_revoke_dialog_body()}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>
              {m.settings_apps_revoke_dialog_cancel()}
            </Button>
            <Button variant="destructive" onClick={handleRevoke} data-testid="confirm-revoke-app">
              {m.settings_apps_revoke_dialog_confirm()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function McpEndpointCard() {
  const { copied, copy } = useCopyFeedback();
  // window may not be defined during SSR but TanStack Start client routes are
  // browser-only — `window.location.origin` is safe inside the component body.
  const endpoint = typeof window !== "undefined" ? `${window.location.origin}/mcp` : "/mcp";

  return (
    <SettingsCard>
      <SettingsCardRow
        label={m.settings_apps_endpoint_label()}
        hint={m.settings_apps_endpoint_hint()}
        align="top"
      >
        <InputGroup>
          <InputGroupInput readOnly value={endpoint} className="font-mono text-xs" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              onClick={() => void copy(endpoint)}
              aria-label={m.settings_apps_endpoint_copy()}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </SettingsCardRow>
    </SettingsCard>
  );
}

function AppRow({
  app,
  isFirst,
  onRevoke,
}: {
  app: MockAuthorizedApp;
  isFirst: boolean;
  onRevoke: () => void;
}) {
  const initial = app.name.charAt(0).toUpperCase();
  return (
    <li
      data-testid={`authorized-app-${app.clientId}`}
      className={cn(
        "flex items-start gap-3 px-5 py-4 sm:px-6",
        !isFirst && "border-t border-border",
      )}
    >
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-base font-semibold text-foreground"
        aria-hidden="true"
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{app.name}</p>
        <p className="select-all font-mono text-xs text-muted-foreground">{app.clientId}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Connected {relativeTime(new Date(app.authorizedAt))} · Last active{" "}
          {relativeTime(new Date(app.lastSeenAt))}
        </p>
        {app.scopes.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {app.scopes.map((scope) => (
              <Badge key={scope} variant="secondary">
                {scope}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <Button variant="outline" size="sm" onClick={onRevoke} data-testid={`revoke-${app.clientId}`}>
        {m.settings_apps_revoke_dialog_confirm()}
      </Button>
    </li>
  );
}

function AppsEmpty() {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="flex size-11 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <LayersIcon className="size-5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{m.settings_apps_empty_title()}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          {m.settings_apps_empty_description()}
        </p>
      </div>
    </div>
  );
}
