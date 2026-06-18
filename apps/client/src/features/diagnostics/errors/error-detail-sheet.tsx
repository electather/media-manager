import { Suspense } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { m } from "@/paraglide/messages";
import { CopyButton } from "@/shared/components/copy-button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/shared/ui/sheet";
import { Skeleton } from "@/shared/ui/skeleton";
import { Separator } from "@/shared/ui/separator";
import { absoluteDateTime } from "@/shared/lib/time-format";
import { DiagnosticsErrorBoundary } from "../shared/error-boundary";
import { diagnosticsKeys } from "../shared/query-keys";
import { fetchErrorDetail } from "../shared/fetchers";
import { ThreadChip } from "../thread-chip";
import type { ErrorDetail } from "../shared/types";

interface Props {
  selectedId: string | null;
  onClose: () => void;
  onJumpThread: (requestId: string) => void;
}

export function ErrorDetailSheet({ selectedId, onClose, onJumpThread }: Props) {
  const open = Boolean(selectedId);

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent side="right" className="w-full max-w-xl gap-0 sm:max-w-xl">
        {selectedId ? (
          <DiagnosticsErrorBoundary
            key={selectedId}
            queryKey={diagnosticsKeys.errors.detail(selectedId)}
          >
            <Suspense fallback={<DetailSkeleton />}>
              <ErrorDetailContent id={selectedId} onJumpThread={onJumpThread} />
            </Suspense>
          </DiagnosticsErrorBoundary>
        ) : (
          <DetailEmpty />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ErrorDetailContent({
  id,
  onJumpThread,
}: {
  id: string;
  onJumpThread: (requestId: string) => void;
}) {
  const { data } = useSuspenseQuery({
    queryKey: diagnosticsKeys.errors.detail(id),
    queryFn: () => fetchErrorDetail(id),
  });
  const detail: ErrorDetail = data.record;

  return (
    <>
      <SheetHeader className="border-b border-border">
        <SheetTitle className="font-mono text-sm">
          {detail.code ?? m.diagnostics_detail_title_fallback()}
        </SheetTitle>
        <p className="text-xs text-muted-foreground">{absoluteDateTime(detail.createdAt)}</p>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <ErrorBody detail={detail} onJumpThread={onJumpThread} />
      </div>
    </>
  );
}

function DetailSkeleton() {
  return (
    <>
      <SheetHeader className="border-b border-border">
        <SheetTitle className="font-mono text-sm">
          {m.diagnostics_detail_title_fallback()}
        </SheetTitle>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </>
  );
}

function DetailEmpty() {
  return (
    <>
      <SheetHeader className="border-b border-border">
        <SheetTitle className="font-mono text-sm">
          {m.diagnostics_detail_title_fallback()}
        </SheetTitle>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <p className="text-sm text-muted-foreground">{m.diagnostics_detail_no_record()}</p>
      </div>
    </>
  );
}

// Every branch corresponds to an optional record field rendered as its own
// section; combining them would not simplify.
// fallow-ignore-next-line complexity
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
        <h3 className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
          {m.diagnostics_detail_summary()}
        </h3>
        <p className="text-foreground/90">{detail.devMessage}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ThreadChip requestId={detail.requestId} onJump={onJumpThread} />
          <CopyButton value={detail.requestId} />
          {detail.route ? <span className="font-mono text-xs">{detail.route}</span> : null}
          {detail.httpStatus !== null ? (
            <span>{m.diagnostics_detail_http_status({ status: detail.httpStatus })}</span>
          ) : null}
        </div>
      </section>

      <Separator />

      {detail.stack ? (
        <section className="space-y-2">
          <h3 className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
            {m.diagnostics_detail_stack()}
          </h3>
          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed">
            {detail.stack}
          </pre>
        </section>
      ) : null}

      {detail.context ? (
        <section className="space-y-2">
          <h3 className="font-mono text-xs tracking-wider text-muted-foreground/80 uppercase">
            {m.diagnostics_detail_context()}
          </h3>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-relaxed">
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
