import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { LoaderCircleIcon } from "lucide-react";
import type { PersonalKeyFallbackPolicy } from "@ent-mcp/shared/plugins";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const POLICIES: ReadonlyArray<{ value: PersonalKeyFallbackPolicy; label: string }> = [
  { value: "off", label: "Off" },
  { value: "admin-first", label: "Admin-first" },
  { value: "personal-first", label: "Personal-first" },
];

const EXPLAINERS: Record<PersonalKeyFallbackPolicy, string> = {
  off: "Admin and user keys are kept separate. Global calls use the admin pool; user calls use the user's own keys only.",
  "admin-first":
    "Admin-owned keys are tried first; users' own keys only kick in when the admin pool is exhausted for that call.",
  "personal-first":
    "Users' own keys are tried first; admin-owned keys only fill in when the user's pool is exhausted.",
};

interface PersonalKeyFallbackControlProps {
  pluginId: string;
  policy: PersonalKeyFallbackPolicy;
  /**
   * Pure-global plugins (no user-scoped capabilities) get the segmented
   * control rendered disabled with an explanatory tooltip; the design doc
   * explicitly bans changing the policy in that case.
   */
  isPureGlobal: boolean;
  onChanged: () => void;
}

/**
 * Three-way segmented control mapped to `"off" | "admin-first" | "personal-first"`
 * with an explainer that swaps based on the active policy. Optimistic on
 * change: the UI flips immediately and the `PATCH /personal-key-fallback`
 * mutation either confirms (refetch) or reverts on failure with a toast.
 */
export function PersonalKeyFallbackControl({
  pluginId,
  policy,
  isPureGlobal,
  onChanged,
}: PersonalKeyFallbackControlProps) {
  const [optimistic, setOptimistic] = useState<PersonalKeyFallbackPolicy>(policy);

  // Keep the optimistic state aligned with the upstream value if the parent
  // refetches and the row's policy changes (e.g. someone else updated it in
  // another tab, then the admin page polled).
  useEffect(() => {
    setOptimistic(policy);
  }, [policy]);

  const mutation = useMutation({
    mutationFn: async (next: PersonalKeyFallbackPolicy) => {
      const res = await api.plugins[":id"]["personal-key-fallback"].$patch({
        param: { id: pluginId },
        json: { policy: next },
      });
      if (!res.ok) throw new Error("Failed to update fallback policy.");
    },
    onSuccess: () => {
      toast.success("Fallback policy updated.");
      onChanged();
    },
    onError: (_err, _next, _ctx) => {
      // Revert the optimistic flip — the server didn't accept the change.
      setOptimistic(policy);
      toast.error("Couldn't update fallback policy. Try again.");
    },
  });

  const onSelect = (next: PersonalKeyFallbackPolicy) => {
    if (next === optimistic || mutation.isPending) return;
    setOptimistic(next);
    mutation.mutate(next);
  };

  const segmented = (
    <div
      role="radiogroup"
      aria-label="Personal key fallback policy"
      className={cn(
        "inline-flex rounded-md border border-border bg-muted/30 p-0.5 text-xs",
        isPureGlobal && "opacity-60",
      )}
    >
      {POLICIES.map((p) => {
        const active = p.value === optimistic;
        return (
          <Button
            key={p.value}
            type="button"
            role="radio"
            aria-checked={active}
            variant="ghost"
            size="sm"
            onClick={() => onSelect(p.value)}
            disabled={isPureGlobal || mutation.isPending}
            className={cn(
              "h-7 px-3 font-normal",
              active && "bg-background shadow-sm",
              !active && "text-muted-foreground",
            )}
          >
            {mutation.isPending && active ? (
              <LoaderCircleIcon className="mr-1 size-3 animate-spin" aria-hidden="true" />
            ) : null}
            {p.label}
          </Button>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Personal key fallback</span>
        {isPureGlobal ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span tabIndex={0} className="inline-flex">
                  {segmented}
                </span>
              }
            />
            <TooltipContent side="top">
              Only applies to plugins with user-scoped capabilities.
            </TooltipContent>
          </Tooltip>
        ) : (
          segmented
        )}
      </div>
      <p className="text-xs leading-snug text-muted-foreground" aria-live="polite">
        {EXPLAINERS[optimistic]}
      </p>
    </div>
  );
}
