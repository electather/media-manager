import { LoaderCircleIcon } from "lucide-react";
import type { AuthorizedApp } from "@ent-mcp/shared/users";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/relative-time";

export interface AuthorizedAppRowProps {
  app: AuthorizedApp;
  onRevoke: (clientId: string) => void;
  pending?: boolean;
}

export function AuthorizedAppRow({ app, onRevoke, pending = false }: AuthorizedAppRowProps) {
  return (
    <div
      data-testid={`authorized-app-${app.clientId}`}
      className="flex items-start justify-between gap-4 px-4 py-4"
    >
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">{app.name}</p>
        <p className="font-mono text-xs text-muted-foreground select-all">{app.clientId}</p>
        <p className="text-xs text-muted-foreground">
          Connected {relativeTime(app.connectedAt)} · Last active {relativeTime(app.lastUsedAt)}
        </p>
        {app.scopes.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {app.scopes.map((scope) => (
              <Badge key={scope} variant="secondary">
                {scope}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => onRevoke(app.clientId)}
        data-testid={`revoke-${app.clientId}`}
      >
        {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
        Revoke
      </Button>
    </div>
  );
}
