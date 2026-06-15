import { Suspense, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { requestFlowKeys } from "../lib/query-keys";

type Props = {
  mediaType: "movie" | "tv";
  children: ReactNode;
};

/**
 * Mounts the request picker under a `<Suspense>` + `<ErrorBoundary>` pair.
 * `useRequestTargets` is a `useSuspenseQuery` hook, so the picker body must
 * render under a Suspense boundary; the error fallback offers a retry that
 * resets the targets cache for this `mediaType`.
 */
export function RequestPickerBoundary({ mediaType, children }: Props) {
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <PickerErrorFallback mediaType={mediaType} message={error.message} reset={reset} />
      )}
    >
      <Suspense fallback={<RequestPickerSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function RequestPickerSkeleton() {
  return (
    <div className="flex w-80 flex-col gap-3 p-3">
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        <div className="h-3 w-40 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="flex flex-col gap-1">
        <div className="h-12 animate-pulse rounded-md bg-muted/40" />
        <div className="h-12 animate-pulse rounded-md bg-muted/40" />
      </div>
    </div>
  );
}

function PickerErrorFallback({
  mediaType,
  message,
  reset,
}: {
  mediaType: "movie" | "tv";
  message: string;
  reset: () => void;
}) {
  const queryClient = useQueryClient();
  const onRetry = () => {
    void queryClient.resetQueries({ queryKey: requestFlowKeys.targets(mediaType) });
    reset();
  };
  return (
    <div className="flex w-80 flex-col gap-3 p-3 text-center">
      <p className="text-sm font-medium">{m.request_picker_load_failed()}</p>
      <p className="text-xs text-muted-foreground">{message}</p>
      <div className="flex justify-center">
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          {m.request_picker_load_retry()}
        </Button>
      </div>
    </div>
  );
}
