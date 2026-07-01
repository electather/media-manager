import { LoaderCircleIcon } from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { relativeTime } from "@/shared/lib/time-format";
import { useParsedUserAgent } from "@/shared/hooks/use-parsed-user-agent";
import { m } from "@/paraglide/messages";

export interface SessionListItem {
  id: string;
  token: string;
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SessionRowProps {
  session: SessionListItem;
  /** True when this session belongs to the device viewing the page. */
  isCurrent: boolean;
  /** Called when the user confirms revocation. */
  onRevoke: (token: string) => void;
  /** True while a revoke mutation for this token is in flight. */
  pending?: boolean;
}

/**
 * One row in the active-sessions list on the Security tab.
 */
// fallow-ignore-next-line complexity
export function SessionRow({ session, isCurrent, onRevoke, pending = false }: SessionRowProps) {
  const ua = useParsedUserAgent(session.userAgent);
  const ip = session.ipAddress?.trim() || null;
  const showIp = !ua.unknown && !!ip;

  // Build the meta line piece-by-piece so missing fields don't leave dangling
  // separators ("Unknown device, ").
  const meta: string[] = [];
  if (showIp) meta.push(ip!);
  meta.push(m.settings_security_sessions_signed_in({ time: relativeTime(session.createdAt) }));
  meta.push(m.settings_security_sessions_last_active({ time: relativeTime(session.updatedAt) }));

  return (
    <div
      data-testid={`session-row-${session.id}`}
      className="flex items-start justify-between gap-4 rounded-lg border border-border px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {session.userAgent ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className="text-sm font-medium"
                    aria-label={m.settings_security_sessions_user_agent({
                      agent: session.userAgent,
                    })}
                  >
                    {ua.label}
                  </span>
                }
              />
              <TooltipContent>
                <span className="break-all">{session.userAgent}</span>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-sm font-medium">{ua.label}</span>
          )}
          {isCurrent ? (
            <Badge variant="secondary">{m.settings_security_sessions_this_device()}</Badge>
          ) : null}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{meta.join(" · ")}</p>
      </div>

      {!isCurrent ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRevoke(session.token)}
          disabled={pending}
        >
          {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {m.settings_security_sessions_revoke()}
        </Button>
      ) : null}
    </div>
  );
}
