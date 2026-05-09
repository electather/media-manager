import { useQuery } from "@tanstack/react-query";
import { CopyButton } from "@/shared/ui/copy-button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import { Skeleton } from "@/shared/ui/skeleton";
import { Separator } from "@/shared/ui/separator";
import { diagnosticsKeys } from "../shared/query-keys";
import { fetchErrorDetail } from "../shared/fetchers";
import { formatAbs } from "../shared/format";
import { ThreadChip } from "../thread-chip";
import type { ErrorDetail } from "../shared/types";

interface Props {
  selectedId: string | null;
  onClose: () => void;
  onJumpThread: (requestId: string) => void;
}

/** Right-anchored detail sheet for an error record. Loads on demand and
 *  reveals stack trace, scrubbed context, and a thread chip wired to the
 *  page-level jump handler so the reader can pivot to the perf tab on the
 *  same request id. */
export function ErrorDetailSheet({ selectedId, onClose, onJumpThread }: Props) {
  const detailQuery = useQuery({
    queryKey: selectedId ? diagnosticsKeys.errors.detail(selectedId) : ["disabled"],
    queryFn: () => fetchErrorDetail(selectedId!),
    enabled: Boolean(selectedId),
  });
  const open = Boolean(selectedId);
  const detail = detailQuery.data?.record as ErrorDetail | undefined;

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent side="right" className="w-full max-w-xl gap-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="font-mono text-sm">{detail?.code ?? "Error detail"}</SheetTitle>
          {detail ? (
            <p className="text-xs text-muted-foreground">{formatAbs(detail.createdAt)}</p>
          ) : null}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {detailQuery.isPending ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : detail ? (
            <ErrorBody detail={detail} onJumpThread={onJumpThread} />
          ) : (
            <p className="text-sm text-muted-foreground">No record selected.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ErrorBody({
  detail,
  onJumpThread,
}: {
  detail: ErrorDetail;
  onJumpThread: (requestId: string) => void;
}) {
  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-2">
        <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
          Summary
        </h3>
        <p className="text-foreground/90">{detail.devMessage}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ThreadChip requestId={detail.requestId} onJump={onJumpThread} />
          <CopyButton value={detail.requestId} />
          {detail.route ? <span className="font-mono text-xs">{detail.route}</span> : null}
          {detail.httpStatus !== null ? <span>HTTP {detail.httpStatus}</span> : null}
        </div>
      </section>

      <Separator />

      {detail.stack ? (
        <section className="space-y-2">
          <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
            Stack
          </h3>
          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
            {detail.stack}
          </pre>
        </section>
      ) : null}

      {detail.context ? (
        <section className="space-y-2">
          <h3 className="font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
            Context (scrubbed)
          </h3>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
            {pretty(detail.context)}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
