import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { LoaderCircleIcon } from "lucide-react";
import type { PersonalKeyFallbackPolicy } from "@nama/shared/plugins";

import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { fetchSetFallbackPolicy } from "../lib/fetchers";

/** Label function for the three policy values, backed by `m.*`. */
function policyLabel(policy: PersonalKeyFallbackPolicy): string {
  if (policy === "off") return m.admin_plugins_fallback_policy_off_label();
  if (policy === "admin-first") return m.admin_plugins_fallback_policy_admin_first_label();
  return m.admin_plugins_fallback_policy_personal_first_label();
}

/** Explainer function for the three policy values, backed by `m.*`. */
function policyExplainer(policy: PersonalKeyFallbackPolicy): string {
  if (policy === "off") return m.admin_plugins_fallback_policy_off_explainer();
  if (policy === "admin-first") return m.admin_plugins_fallback_policy_admin_first_explainer();
  return m.admin_plugins_fallback_policy_personal_first_explainer();
}

const POLICIES: ReadonlyArray<PersonalKeyFallbackPolicy> = ["off", "admin-first", "personal-first"];

interface PolicyButtonProps {
  value: PersonalKeyFallbackPolicy;
  active: boolean;
  isPureGlobal: boolean;
  isPending: boolean;
  onSelect: (value: PersonalKeyFallbackPolicy) => void;
}

// fallow-ignore-next-line complexity
function PolicyButton({ value, active, isPureGlobal, isPending, onSelect }: PolicyButtonProps) {
  // For pure-global plugins keep the radios reachable to assistive
  // tech (`aria-disabled` instead of native `disabled`) — HTML
  // `disabled` removes elements from the accessibility tree in some
  // browsers, defeating the radiogroup announcement. Block clicks
  // on the handler side when `isPureGlobal` is true. The pending
  // path keeps native `disabled` since it's transient and the
  // active button still announces via `aria-busy` semantics.
  const ariaDisabled = isPureGlobal;
  const nativelyDisabled = !isPureGlobal && isPending;
  return (
    <Button
      type="button"
      role="radio"
      aria-checked={active}
      aria-disabled={ariaDisabled || undefined}
      tabIndex={ariaDisabled ? -1 : undefined}
      variant="ghost"
      size="sm"
      onClick={() => {
        if (ariaDisabled) return;
        onSelect(value);
      }}
      disabled={nativelyDisabled}
      className={cn(
        "h-7 px-3 font-normal",
        active && "bg-background shadow-sm",
        !active && "text-muted-foreground",
        ariaDisabled && "cursor-not-allowed",
      )}
    >
      {isPending && active ? (
        <LoaderCircleIcon className="mr-1 size-3 animate-spin" aria-hidden="true" />
      ) : null}
      {policyLabel(value)}
    </Button>
  );
}

interface SegmentedControlProps {
  optimistic: PersonalKeyFallbackPolicy;
  isPureGlobal: boolean;
  isPending: boolean;
  onSelect: (value: PersonalKeyFallbackPolicy) => void;
}

function SegmentedControl({
  optimistic,
  isPureGlobal,
  isPending,
  onSelect,
}: SegmentedControlProps) {
  return (
    <div
      role="radiogroup"
      aria-label={m.admin_plugins_fallback_policy_label()}
      className={cn(
        "inline-flex rounded-md border border-border bg-muted/30 p-0.5 text-xs",
        isPureGlobal && "opacity-60",
      )}
    >
      {POLICIES.map((p) => (
        <PolicyButton
          key={p}
          value={p}
          active={p === optimistic}
          isPureGlobal={isPureGlobal}
          isPending={isPending}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

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
    mutationFn: (next: PersonalKeyFallbackPolicy) =>
      fetchSetFallbackPolicy({ pluginId, policy: next }),
    onSuccess: () => {
      toast.success(m.admin_plugins_toast_fallback_saved());
      onChanged();
    },
    onError: (_err, _next, _ctx) => {
      // Revert the optimistic flip — the server didn't accept the change.
      setOptimistic(policy);
      toast.error(m.admin_plugins_toast_fallback_error());
    },
  });

  const onSelect = (next: PersonalKeyFallbackPolicy) => {
    if (next === optimistic || mutation.isPending) return;
    setOptimistic(next);
    mutation.mutate(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{m.admin_plugins_fallback_policy_label()}</span>
        {isPureGlobal ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span tabIndex={0} className="inline-flex">
                  <SegmentedControl
                    optimistic={optimistic}
                    isPureGlobal={isPureGlobal}
                    isPending={mutation.isPending}
                    onSelect={onSelect}
                  />
                </span>
              }
            />
            <TooltipContent side="top">
              {m.admin_plugins_fallback_policy_pure_global_tooltip()}
            </TooltipContent>
          </Tooltip>
        ) : (
          <SegmentedControl
            optimistic={optimistic}
            isPureGlobal={isPureGlobal}
            isPending={mutation.isPending}
            onSelect={onSelect}
          />
        )}
      </div>
      <p className="text-xs leading-snug text-muted-foreground" aria-live="polite">
        {policyExplainer(optimistic)}
      </p>
    </div>
  );
}
