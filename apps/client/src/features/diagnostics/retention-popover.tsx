import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SettingsIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Separator } from "@/shared/ui/separator";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { diagnosticsKeys } from "./shared/query-keys";
import { fetchDiagnosticsConfig, fetchUpdateDiagnosticsConfig } from "./shared/fetchers";
import { DiagnosticsApiError, type DiagnosticsConfig } from "./shared/types";

const ERROR_OPTIONS = [7, 14, 30, 60, 90] as const;
const PERF_OPTIONS = [1, 3, 7, 14, 30] as const;

/** Edits both retention windows in one popover. The button label tracks the
 *  current values so the affordance reads as "current state, click to edit". */
export function RetentionPopover() {
  const queryClient = useQueryClient();
  const cfgQuery = useQuery({
    queryKey: diagnosticsKeys.config(),
    queryFn: fetchDiagnosticsConfig,
  });
  const mutation = useMutation({
    mutationFn: fetchUpdateDiagnosticsConfig,
    // Optimistic: patch the active pill immediately so the click does not wait
    // on the round trip, then reconcile on settle.
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: diagnosticsKeys.config() });
      const snapshot = queryClient.getQueryData<DiagnosticsConfig>(diagnosticsKeys.config());
      if (snapshot) {
        queryClient.setQueryData<DiagnosticsConfig>(diagnosticsKeys.config(), {
          ...snapshot,
          ...body,
        });
      }
      return { snapshot };
    },
    onError: (error, _body, ctx) => {
      if (ctx?.snapshot) {
        queryClient.setQueryData<DiagnosticsConfig>(diagnosticsKeys.config(), ctx.snapshot);
      }
      const message =
        error instanceof DiagnosticsApiError
          ? (error.body?.devMessage ?? error.message)
          : String(error);
      toast.error(m.diagnostics_retention_update_failed({ message }));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: diagnosticsKeys.config() });
    },
  });
  const cfg = cfgQuery.data;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            aria-label={m.diagnostics_retention_aria()}
            className="gap-2 max-sm:size-7 max-sm:px-0"
          >
            <SettingsIcon className="size-3.5" />
            <span className="hidden sm:inline">{m.diagnostics_retention_button()}</span>
            {cfg ? (
              <span className="hidden font-mono text-xs text-muted-foreground/80 sm:inline">
                {cfg.errorRetentionDays}d / {cfg.perfRetentionDays}d
              </span>
            ) : null}
          </Button>
        }
      />
      <PopoverContent className="w-80 p-0" align="end">
        <div className="border-b border-border p-4">
          <div className="text-sm font-medium">{m.diagnostics_retention_title()}</div>
          <p className="mt-1 text-xs text-muted-foreground">{m.diagnostics_retention_helper()}</p>
        </div>
        <div className="space-y-4 p-4">
          {cfg ? (
            <>
              <RetentionRow
                label={m.diagnostics_retention_errors_label()}
                helper={m.diagnostics_retention_errors_helper()}
                value={cfg.errorRetentionDays}
                options={ERROR_OPTIONS}
                disabled={mutation.isPending}
                onChange={(days) => mutation.mutate({ errorRetentionDays: days })}
              />
              <Separator />
              <RetentionRow
                label={m.diagnostics_retention_perf_label()}
                helper={m.diagnostics_retention_perf_helper()}
                value={cfg.perfRetentionDays}
                options={PERF_OPTIONS}
                disabled={mutation.isPending}
                onChange={(days) => mutation.mutate({ perfRetentionDays: days })}
              />
            </>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-8 w-full" />
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface RetentionRowProps {
  label: string;
  helper: string;
  value: number;
  options: readonly number[];
  disabled: boolean;
  onChange: (days: number) => void;
}

function RetentionRow({ label, helper, value, options, disabled, onChange }: RetentionRowProps) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground/85">{label}</span>
        <span className="font-mono text-xs text-muted-foreground/80">
          {m.diagnostics_retention_value_days({ value })}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground/80">{helper}</p>
      <div className="mt-2 flex gap-1">
        {options.map((opt) => {
          const active = opt === value;
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt)}
              className={cn(
                "flex-1 rounded-md border px-2 py-1 font-mono text-xs font-medium transition-colors",
                active
                  ? "border-primary/45 bg-primary/15 text-primary"
                  : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
                disabled && "opacity-60",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
