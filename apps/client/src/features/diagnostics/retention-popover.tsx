import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SettingsIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Separator } from "@/shared/ui/separator";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { diagnosticsKeys } from "./shared/query-keys";
import { fetchDiagnosticsConfig, fetchUpdateDiagnosticsConfig } from "./shared/fetchers";
import type { DiagnosticsConfig } from "./shared/types";

const ERROR_OPTIONS = [7, 14, 30, 60, 90] as const;
const PERF_OPTIONS = [1, 3, 7, 14, 30] as const;

/** Edits both retention windows in one popover. The button label tracks the
 *  current values so the affordance reads as "current state, click to edit". */
export function RetentionPopover() {
  const queryClient = useQueryClient();
  const cfgQuery = useQuery({
    queryKey: diagnosticsKeys.config(),
    queryFn: fetchDiagnosticsConfig,
    staleTime: 60_000,
  });
  const mutation = useMutation({
    mutationFn: fetchUpdateDiagnosticsConfig,
    onSuccess: (next) => {
      queryClient.setQueryData<DiagnosticsConfig>(diagnosticsKeys.config(), next);
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
            aria-label="Retention"
            className="gap-2 max-sm:size-7 max-sm:px-0"
          >
            <SettingsIcon className="size-3.5" />
            <span className="hidden sm:inline">Retention</span>
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
          <div className="text-sm font-medium">Diagnostics retention</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Sweeps run nightly. New windows take effect on the next sweep.
          </p>
        </div>
        <div className="space-y-4 p-4">
          {cfg ? (
            <>
              <RetentionRow
                label="Errors"
                helper="Stored alongside warnings and info — only the default view filters them."
                value={cfg.errorRetentionDays}
                options={ERROR_OPTIONS}
                disabled={mutation.isPending}
                onChange={(days) => mutation.mutate({ errorRetentionDays: days })}
              />
              <Separator />
              <RetentionRow
                label="Performance"
                helper="Higher volume — short windows keep storage tame."
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
        <span className="font-mono text-xs text-muted-foreground/80">{value} days</span>
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
