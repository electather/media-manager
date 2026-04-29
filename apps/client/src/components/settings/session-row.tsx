import { LoaderCircleIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { parseUserAgent } from "@/lib/user-agent";

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
  const ua = parseUserAgent(session.userAgent);
  const ip = session.ipAddress?.trim() || null;
  const showIp = !ua.unknown && !!ip;

  const created = toDate(session.createdAt);
  const updated = toDate(session.updatedAt);

  // Build the meta line piece-by-piece so missing fields don't leave dangling
  // separators ("Unknown device, ").
  const meta: string[] = [];
  if (showIp) meta.push(ip!);
  meta.push(`Signed in ${relativeTime(created)}`);
  meta.push(`Last active ${relativeTime(updated)}`);

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
                    aria-label={`User agent: ${session.userAgent}`}
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
          {isCurrent ? <Badge variant="secondary">This device</Badge> : null}
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
          Revoke
        </Button>
      ) : null}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDate(input: string | number | Date): Date {
  if (input instanceof Date) return input;
  return new Date(input);
}

/** Coarse relative-time formatter, mirroring the helper used by the jobs page. */
function relativeTime(d: Date): string {
  const ts = d.getTime();
  if (!Number.isFinite(ts)) return "just now";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
