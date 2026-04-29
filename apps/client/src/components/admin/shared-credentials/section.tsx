import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckIcon,
  ClockIcon,
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PlusIcon,
  TrashIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import type { InferResponseType } from "hono/client";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Skeleton } from "@/shared/ui/skeleton";
import { Switch } from "@/shared/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { api } from "@/shared/lib/api";
import { useNow } from "@/shared/hooks/use-now";
import type { JSONSchema } from "@ent-mcp/shared";

import { SharedCredentialDialog } from "./dialog";

type SharedCredentialEntry = InferResponseType<
  (typeof api.plugins)[":id"]["shared-credentials"]["$get"]
>["entries"][number];

interface SharedCredentialsSectionProps {
  pluginId: string;
  pluginName: string;
  schema: JSONSchema;
  poolable: boolean;
  /** Hint copy on the empty state. */
  capabilityHint: "global-only" | "user-fallback" | "global-and-fallback";
  onChanged: () => void;
}

/**
 * Inline shared-credentials table on the admin plugin card. Lives outside
 * the `ConfigureDialog` from previous phases — admins can see + manage the
 * pool without opening a dialog.
 */
// fallow-ignore-next-line complexity
export function SharedCredentialsSection({
  pluginId,
  pluginName,
  schema,
  poolable,
  capabilityHint,
  onChanged,
}: SharedCredentialsSectionProps) {
  const qc = useQueryClient();
  const entries = useQuery({
    queryKey: ["admin", "plugins", pluginId, "shared-credentials"],
    queryFn: async () => {
      const res = await api.plugins[":id"]["shared-credentials"].$get({
        param: { id: pluginId },
      });
      if (!res.ok) throw new Error("Failed to load shared credentials.");
      const body = await res.json();
      return body.entries;
    },
  });

  // Per design doc § "TanStack Query invalidation map": only changes that
  // affect the meta line counters (add, delete, enable-toggle) should
  // invalidate the parent `["admin", "plugins"]` key. A label/value-only
  // edit fires `refetchLocal` so the row list updates without spawning an
  // extra top-level plugins query.
  const refetchLocal = () => {
    void qc.invalidateQueries({
      queryKey: ["admin", "plugins", pluginId, "shared-credentials"],
    });
  };
  const refetchPool = () => {
    refetchLocal();
    onChanged();
  };

  const [dialog, setDialog] = useState<
    { kind: "none" } | { kind: "add" } | { kind: "edit"; entry: SharedCredentialEntry }
  >({ kind: "none" });
  const [deleteState, setDeleteState] = useState<SharedCredentialEntry | null>(null);

  const list = entries.data ?? [];
  const atCapacity = !poolable && list.length >= 1;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">Shared credentials</h4>
          <p className="text-xs text-muted-foreground">
            Admin-owned pool. Users without their own connection still get global capabilities
            through these.
          </p>
        </div>
        <AddButton
          onClick={() => setDialog({ kind: "add" })}
          disabled={atCapacity}
          tooltip={atCapacity ? "This plugin only supports one shared credential." : null}
        />
      </div>

      {entries.isLoading ? (
        <div className="rounded-md border border-border">
          <Skeleton className="m-2 h-12" />
        </div>
      ) : entries.error ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          <span>Couldn't load shared credentials.</span>
          <Button variant="ghost" size="sm" onClick={() => entries.refetch()}>
            Retry
          </Button>
        </div>
      ) : list.length === 0 ? (
        <EmptyRow
          hint={capabilityHint}
          onAdd={() => setDialog({ kind: "add" })}
          atCapacity={atCapacity}
        />
      ) : (
        <CredentialsTable
          rows={list}
          pluginId={pluginId}
          onEdit={(entry) => setDialog({ kind: "edit", entry })}
          onDeleteRequest={setDeleteState}
          onPoolChange={refetchPool}
        />
      )}

      <SharedCredentialDialog
        open={dialog.kind !== "none"}
        onOpenChange={(open) => (open ? undefined : setDialog({ kind: "none" }))}
        pluginId={pluginId}
        pluginName={pluginName}
        schema={schema}
        existing={dialog.kind === "edit" ? dialog.entry : undefined}
        onSaved={(affectsPoolCounts) => (affectsPoolCounts ? refetchPool : refetchLocal)()}
      />

      <DeleteCredentialDialog
        entry={deleteState}
        pluginId={pluginId}
        onClose={() => setDeleteState(null)}
        onDeleted={refetchPool}
      />
    </section>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyRow({
  hint,
  onAdd,
  atCapacity,
}: {
  hint: SharedCredentialsSectionProps["capabilityHint"];
  onAdd: () => void;
  atCapacity: boolean;
}) {
  const description =
    hint === "global-only"
      ? "Global-scoped capabilities will return CAPABILITY_UNAVAILABLE until one is added."
      : hint === "global-and-fallback"
        ? "Global-scoped and user-fallback capabilities will return CAPABILITY_UNAVAILABLE until one is added."
        : "User-fallback capabilities will return CAPABILITY_UNAVAILABLE until one is added.";
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
      <span>No shared credentials configured. {description}</span>
      <Button size="sm" onClick={onAdd} disabled={atCapacity}>
        <PlusIcon /> Add credential
      </Button>
    </div>
  );
}

// ─── Add button (with disabled-capacity tooltip) ─────────────────────────────

function AddButton({
  onClick,
  disabled,
  tooltip,
}: {
  onClick: () => void;
  disabled: boolean;
  tooltip: string | null;
}) {
  const button = (
    <Button size="sm" variant="outline" onClick={onClick} disabled={disabled}>
      <PlusIcon /> Add credential
    </Button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span tabIndex={0} className="inline-flex">
            {button}
          </span>
        }
      />
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

function CredentialsTable({
  rows,
  pluginId,
  onEdit,
  onDeleteRequest,
  onPoolChange,
}: {
  rows: ReadonlyArray<SharedCredentialEntry>;
  pluginId: string;
  onEdit: (entry: SharedCredentialEntry) => void;
  onDeleteRequest: (entry: SharedCredentialEntry) => void;
  /** Called after the row's enable toggle succeeds — meta line counts shift. */
  onPoolChange: () => void;
}) {
  // Tick once per second only while at least one row is in cooldown — the
  // hook ignores its interval otherwise so the rest of the admin page
  // doesn't re-render on every second.
  const nowMs = useNow(1000, {
    active: rows.some((r) => r.retryAfter !== null && r.retryAfter > Date.now() / 1000),
  });

  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
      {rows.map((entry) => (
        <CredentialRow
          key={entry.id}
          entry={entry}
          pluginId={pluginId}
          nowMs={nowMs}
          onEdit={() => onEdit(entry)}
          onDeleteRequest={() => onDeleteRequest(entry)}
          onPoolChange={onPoolChange}
        />
      ))}
    </ul>
  );
}

// ─── Single row ──────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
function CredentialRow({
  entry,
  pluginId,
  nowMs,
  onEdit,
  onDeleteRequest,
  onPoolChange,
}: {
  entry: SharedCredentialEntry;
  pluginId: string;
  nowMs: number;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onPoolChange: () => void;
}) {
  const toggleEnabled = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await api.plugins[":id"]["shared-credentials"][":credId"].$patch({
        param: { id: pluginId, credId: entry.id },
        json: { enabled: next },
      });
      if (!res.ok) throw new Error("Failed to update.");
    },
    // Toggling `enabled` shifts the meta line's enabled/total counts, so
    // the parent plugin row needs to refetch alongside the local list.
    onSuccess: () => onPoolChange(),
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Couldn't update credential.");
    },
  });

  const test = useMutation({
    mutationFn: async () => {
      const res = await api.plugins[":id"]["shared-credentials"][":credId"].test.$post({
        param: { id: pluginId, credId: entry.id },
      });
      if (!res.ok) throw new Error("Test failed.");
      return (await res.json()) as { ok: boolean; message?: string };
    },
  });

  const [showResult, setShowResult] = useState(false);
  useEffect(() => {
    if (!test.isSuccess && !test.isError) return;
    setShowResult(true);
    const id = window.setTimeout(() => setShowResult(false), 3000);
    return () => window.clearTimeout(id);
  }, [test.isSuccess, test.isError, test.data]);

  const cooldownSec =
    entry.retryAfter !== null && entry.retryAfter > nowMs / 1000
      ? Math.ceil(entry.retryAfter - nowMs / 1000)
      : 0;

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center" aria-live="polite">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{entry.label}</span>
        <RowMeta entry={entry} cooldownSec={cooldownSec} />
        {/* TanStack Query v5 keeps `data` from the previous run while a
            new mutation is in flight, so a re-test that errors after a
            previously-successful test would otherwise render "Verified"
            and the error message simultaneously. Gating each branch on
            the matching `isSuccess` / `isError` flag avoids that overlap. */}
        {showResult && test.isSuccess && test.data?.ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
            <CheckIcon className="size-3" /> Verified
          </span>
        ) : null}
        {showResult && test.isSuccess && test.data && !test.data.ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <XIcon className="size-3" /> {test.data.message ?? "Test failed"}
          </span>
        ) : null}
        {showResult && test.isError ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <XIcon className="size-3" /> {(test.error as Error).message}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 self-start sm:self-center">
        <Switch
          checked={entry.enabled}
          onCheckedChange={(next: boolean) => toggleEnabled.mutate(next)}
          disabled={toggleEnabled.isPending}
          aria-label={entry.enabled ? "Disable credential" : "Enable credential"}
        />
        <Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
          Test
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit} disabled={test.isPending}>
          Edit
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`More actions for ${entry.label}`}
            className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontalIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem variant="destructive" onClick={onDeleteRequest}>
              <TrashIcon /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function RowMeta({ entry, cooldownSec }: { entry: SharedCredentialEntry; cooldownSec: number }) {
  if (!entry.enabled) {
    return <span className="text-xs text-muted-foreground">Disabled</span>;
  }
  if (cooldownSec > 0) {
    const mm = String(Math.floor(cooldownSec / 60)).padStart(2, "0");
    const ss = String(cooldownSec % 60).padStart(2, "0");
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
        <ClockIcon className="size-3" /> Retry in {mm}:{ss}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
      <CheckIcon className="size-3" /> Ready
    </span>
  );
}

// ─── Delete confirmation ─────────────────────────────────────────────────────

function DeleteCredentialDialog({
  entry,
  pluginId,
  onClose,
  onDeleted,
}: {
  entry: SharedCredentialEntry | null;
  pluginId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const mutation = useMutation({
    mutationFn: async () => {
      if (!entry) return;
      const res = await api.plugins[":id"]["shared-credentials"][":credId"].$delete({
        param: { id: pluginId, credId: entry.id },
      });
      if (!res.ok) throw new Error("Failed to delete credential.");
    },
    onSuccess: () => {
      toast.success("Shared credential deleted.");
      onDeleted();
      onClose();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Couldn't delete credential.");
    },
  });

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(v) => (!v && !mutation.isPending ? onClose() : undefined)}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-110" showCloseButton={!mutation.isPending}>
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <TriangleAlertIcon className="size-4" />
            Delete &ldquo;{entry?.label}&rdquo;?
          </DialogTitle>
          <DialogDescription>
            This removes the credential from the pool. Capabilities that depend on it will return
            CAPABILITY_UNAVAILABLE until you add a replacement.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
