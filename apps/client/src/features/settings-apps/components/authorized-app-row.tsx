import { LogOutIcon, MoreHorizontalIcon } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";
import { relativeTime } from "@/shared/lib/time-format";
import { m } from "@/paraglide/messages";

import type { AuthorizedApp } from "@nama/shared/users";

import { NameGlyph } from "@/shared/components/name-glyph";

import { ActivityPill } from "./activity-pill";
import { MetaSep } from "./meta-sep";
import { ScopeChip } from "./scope-chip";

export interface AuthorizedAppRowProps {
  app: AuthorizedApp;
  isFirst?: boolean;
  onRevoke: (app: AuthorizedApp) => void;
}

function formatAuthorizedDate(epochMs: number): string {
  if (!epochMs) return "—";
  try {
    return new Date(epochMs).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

export function AuthorizedAppRow({ app, isFirst = false, onRevoke }: AuthorizedAppRowProps) {
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

      <AppRowMenu app={app} onRevoke={onRevoke} />
    </li>
  );
}

function AppRowHeading({ app }: { app: AuthorizedApp }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium tracking-tight text-foreground">{app.name}</span>
      <ActivityPill status={app.status} />
    </div>
  );
}

function AppRowMeta({ app }: { app: AuthorizedApp }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs tabular-nums text-muted-foreground">
      <span>
        {m.settings_apps_meta_authorized({ date: formatAuthorizedDate(app.connectedAt) })}
      </span>
      {app.lastUsedAt ? (
        <>
          <MetaSep />
          <span>
            {m.settings_apps_meta_last_active({ time: relativeTime(new Date(app.lastUsedAt)) })}
          </span>
        </>
      ) : null}
    </div>
  );
}

function AppRowMenu({
  app,
  onRevoke,
}: {
  app: AuthorizedApp;
  onRevoke: (app: AuthorizedApp) => void;
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
