import { EyeIcon, LogOutIcon, MoreHorizontalIcon, PencilIcon } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { relativeTime } from "@/shared/lib/relative-time";
import { m } from "@/paraglide/messages";

import type { MockAuthorizedApp } from "@/features/settings/mocks";

import { NameGlyph } from "@/shared/components/name-glyph";

import { ActivityPill } from "./activity-pill";
import { MetaSep } from "./meta-sep";
import { ScopeChip } from "./scope-chip";

export interface AuthorizedAppRowProps {
  app: MockAuthorizedApp;
  isFirst?: boolean;
  onRevoke: (app: MockAuthorizedApp) => void;
  onRename: (app: MockAuthorizedApp) => void;
  onViewActivity: (app: MockAuthorizedApp) => void;
}

function formatAuthorizedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

export function AuthorizedAppRow({
  app,
  isFirst = false,
  onRevoke,
  onRename,
  onViewActivity,
}: AuthorizedAppRowProps) {
  return (
    <li
      data-testid={`authorized-app-${app.clientId}`}
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 px-5 py-4 sm:px-6",
        !isFirst && "border-t border-border",
      )}
    >
      <NameGlyph name={app.name} />

      <div className="min-w-0">
        <AppRowHeading app={app} />
        <AppRowMeta app={app} />
        {app.scopes.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {app.scopes.map((scope) => (
              <ScopeChip key={scope} scope={scope} />
            ))}
          </div>
        ) : null}
      </div>

      <AppRowMenu
        app={app}
        onRevoke={onRevoke}
        onRename={onRename}
        onViewActivity={onViewActivity}
      />
    </li>
  );
}

function AppRowHeading({ app }: { app: MockAuthorizedApp }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium tracking-tight text-foreground">
        {app.name}
        {app.deviceLabel ? (
          <>
            <span className="mx-1.5 font-normal text-muted-foreground/60">·</span>
            <span className="font-normal text-muted-foreground">{app.deviceLabel}</span>
          </>
        ) : null}
      </span>
      <ActivityPill status={app.status} />
      {app.version ? (
        <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px] tracking-wider text-muted-foreground">
          {app.version}
        </span>
      ) : null}
    </div>
  );
}

function AppRowMeta({ app }: { app: MockAuthorizedApp }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
      <span className="font-mono">{app.ipAddress}</span>
      <MetaSep />
      <span>
        {m.settings_apps_meta_authorized({ date: formatAuthorizedDate(app.authorizedAt) })}
      </span>
      <MetaSep />
      <span>
        {m.settings_apps_meta_last_active({ time: relativeTime(new Date(app.lastSeenAt)) })}
      </span>
      {app.callsLast24h > 0 ? (
        <>
          <MetaSep />
          <span>{m.settings_apps_meta_calls({ count: app.callsLast24h.toLocaleString() })}</span>
        </>
      ) : null}
    </div>
  );
}

function AppRowMenu({
  app,
  onRevoke,
  onRename,
  onViewActivity,
}: {
  app: MockAuthorizedApp;
  onRevoke: (app: MockAuthorizedApp) => void;
  onRename: (app: MockAuthorizedApp) => void;
  onViewActivity: (app: MockAuthorizedApp) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.settings_apps_action_more({ name: app.name })}
            data-testid={`actions-${app.clientId}`}
          >
            <MoreHorizontalIcon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onViewActivity(app)}>
          <EyeIcon className="size-3.5" />
          {m.settings_apps_action_view_activity()}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRename(app)} data-testid={`rename-${app.clientId}`}>
          <PencilIcon className="size-3.5" />
          {m.settings_apps_action_rename()}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => onRevoke(app)}
          data-testid={`revoke-${app.clientId}`}
        >
          <LogOutIcon className="size-3.5" />
          {m.settings_apps_action_revoke()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
