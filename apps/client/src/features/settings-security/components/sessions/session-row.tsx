import { useMemo } from "react";
import { CheckIcon } from "lucide-react";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { NameGlyph } from "@/shared/components/name-glyph";
import { relativeTime } from "@/shared/lib/time-format";
import { parseUserAgent } from "@/shared/lib/user-agent";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import type { DisplaySession } from "../../lib/types";

export function SessionListRow({
  session,
  isFirst,
  onRevoke,
}: {
  session: DisplaySession;
  isFirst: boolean;
  onRevoke: () => void;
}) {
  const ua = useMemo(() => parseUserAgent(session.userAgent ?? null), [session.userAgent]);
  const showIp = !ua.unknown && !!session.ipAddress;
  const created = new Date(session.createdAt);
  const updated = new Date(session.updatedAt);
  return (
    <li
      data-testid={`session-row-${session.id}`}
      className={cn(
        "flex items-start gap-3 px-5 py-4 sm:px-6",
        !isFirst && "border-t border-border",
      )}
    >
      <NameGlyph name={ua.label} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{ua.label}</span>
          {session.current ? (
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
              <CheckIcon className="size-2.5" aria-hidden="true" />
              {m.settings_security_sessions_this_device()}
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0 text-xs text-muted-foreground">
          {showIp ? <span className="font-mono">{session.ipAddress}</span> : null}
          <span>
            {m.settings_security_sessions_signed_in({
              time: relativeTime(created),
            })}
          </span>
          <span>
            {m.settings_security_sessions_last_active({
              time: relativeTime(updated),
            })}
          </span>
        </p>
      </div>
      {!session.current ? (
        <Button variant="outline" size="sm" onClick={onRevoke}>
          {m.settings_security_sessions_revoke()}
        </Button>
      ) : null}
    </li>
  );
}
