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
import type { JSONSchema } from "@nama/shared";
import { m } from "@/paraglide/messages";

import {
  fetchDeleteSharedCredential,
  fetchPatchSharedCredential,
  fetchSharedCredentials,
  fetchTestSharedCredentialPersisted,
} from "../../lib/fetchers";
import { adminKeys } from "../../lib/query-keys";

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
    queryKey: adminKeys.sharedCredentials(pluginId),
    queryFn: () => fetchSharedCredentials(pluginId).then((body) => body.entries),
  });

  // Per design doc § "TanStack Query invalidation map": only changes that
  // affect the meta line counters (add, delete, enable-toggle) should refetch
  // the parent plugin row. That refetch is the caller's responsibility — it is
  // delegated through `onChanged()` (the tab invalidates its own
  // `adminPluginsKeys.list()` key). A label/value-only edit fires
  // `refetchLocal`, which only re-reads this feature's credentials list so the
  // rows update without spawning an extra top-level plugins query.
  const refetchLocal = () => {
    void qc.invalidateQueries({
      queryKey: adminKeys.sharedCredentials(pluginId),
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
  // Exclude the synthesized bundled row: server ignores `__bundled__` for the
  // non-poolable limit, so admins must still be able to add one real override.
  const atCapacity = !poolable && list.filter((e) => !e.bundled).length >= 1;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">{m.admin_plugins_shared_creds_section_title()}</h4>
          <p className="text-xs text-muted-foreground">
            {m.admin_plugins_shared_creds_section_description()}
          </p>
        </div>
        <AddButton
          onClick={() => setDialog({ kind: "add" })}
          disabled={atCapacity}
          tooltip={atCapacity ? m.admin_plugins_shared_creds_capacity_tooltip() : null}
        />
      </div>

      {entries.isLoading ? (
        <div className="rounded-md border border-border">
          <Skeleton className="m-2 h-12" />
        </div>
      ) : entries.error ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
          <span>{m.admin_plugins_shared_creds_load_error()}</span>
          <Button variant="ghost" size="sm" onClick={() => entries.refetch()}>
            {m.admin_plugins_shared_creds_load_retry()}
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
      ? m.admin_plugins_shared_creds_empty_global_only()
      : hint === "global-and-fallback"
        ? m.admin_plugins_shared_creds_empty_global_and_fallback()
        : m.admin_plugins_shared_creds_empty_user_fallback();
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
      <span>
        {m.admin_plugins_shared_creds_empty_prefix()} {description}
      </span>
      <Button size="sm" onClick={onAdd} disabled={atCapacity}>
        <PlusIcon /> {m.admin_plugins_shared_creds_add()}
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
      <PlusIcon /> {m.admin_plugins_shared_creds_add()}
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
      {rows.map((entry) =>
        entry.bundled ? (
          <BundledCredentialRow key={entry.id} entry={entry} />
        ) : (
          <CredentialRow
            key={entry.id}
            entry={entry}
            pluginId={pluginId}
            nowMs={nowMs}
            onEdit={() => onEdit(entry)}
            onDeleteRequest={() => onDeleteRequest(entry)}
            onPoolChange={onPoolChange}
          />
        ),
      )}
    </ul>
  );
}

// ─── Single row ──────────────────────────────────────────────────────────────

// Read-only row for the synthesized bundled default. No DB row exists, so it
// carries no enable/edit/delete actions — see design §5.
function BundledCredentialRow({ entry }: { entry: SharedCredentialEntry }) {
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{entry.label}</span>
        <span className="text-xs text-muted-foreground">
          {m.admin_plugins_shared_creds_bundled_note()}
        </span>
      </div>
      <span className="self-start rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground sm:self-center">
        {m.admin_plugins_shared_creds_bundled_badge()}
      </span>
    </li>
  );
}

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
  const qc = useQueryClient();

  const toggleEnabled = useMutation({
    mutationFn: (next: boolean) =>
      fetchPatchSharedCredential({ pluginId, credId: entry.id, patch: { enabled: next } }),
    // Optimistic update: flip the row's `enabled` immediately so the Switch
    // moves before the round-trip completes (hard rule 6 — >100ms latency).
    onMutate: async (next: boolean) => {
      await qc.cancelQueries({ queryKey: adminKeys.sharedCredentials(pluginId) });
      const prev = qc.getQueryData<SharedCredentialEntry[]>(adminKeys.sharedCredentials(pluginId));
      qc.setQueryData<SharedCredentialEntry[]>(adminKeys.sharedCredentials(pluginId), (old) =>
        old?.map((row) => (row.id === entry.id ? { ...row, enabled: next } : row)),
      );
      return { prev };
    },
    onError: (_err, _next, ctx) => {
      // Restore the snapshot if the server rejected the change.
      if (ctx?.prev) {
        qc.setQueryData(adminKeys.sharedCredentials(pluginId), ctx.prev);
      }
      toast.error(m.admin_plugins_shared_creds_toast_toggle_error());
    },
    // Toggling `enabled` shifts the meta line's enabled/total counts, so
    // the parent plugin row needs to refetch alongside the local list.
    onSettled: () => onPoolChange(),
  });

  const test = useMutation({
    mutationFn: () => fetchTestSharedCredentialPersisted({ pluginId, credId: entry.id }),
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
            <CheckIcon className="size-3" /> {m.admin_plugins_shared_creds_row_verified()}
          </span>
        ) : null}
        {showResult && test.isSuccess && test.data && !test.data.ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-destructive">
            <XIcon className="size-3" />{" "}
            {test.data.message ?? m.admin_plugins_shared_creds_row_test_failed()}
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
          aria-label={
            entry.enabled
              ? m.admin_plugins_shared_creds_row_disable_aria()
              : m.admin_plugins_shared_creds_row_enable_aria()
          }
        />
        <Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {m.admin_plugins_shared_creds_row_test()}
        </Button>
        <Button variant="outline" size="sm" onClick={onEdit} disabled={test.isPending}>
          {m.admin_plugins_shared_creds_row_edit()}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={m.admin_plugins_shared_creds_row_more_aria({ label: entry.label })}
            className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontalIcon className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem variant="destructive" onClick={onDeleteRequest}>
              <TrashIcon /> {m.admin_plugins_shared_creds_row_delete()}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function RowMeta({ entry, cooldownSec }: { entry: SharedCredentialEntry; cooldownSec: number }) {
  if (!entry.enabled) {
    return (
      <span className="text-xs text-muted-foreground">
        {m.admin_plugins_shared_creds_row_disabled()}
      </span>
    );
  }
  if (cooldownSec > 0) {
    const mm = String(Math.floor(cooldownSec / 60)).padStart(2, "0");
    const ss = String(cooldownSec % 60).padStart(2, "0");
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warning">
        <ClockIcon className="size-3" />{" "}
        {m.admin_plugins_shared_creds_row_retry({ time: `${mm}:${ss}` })}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-success">
      <CheckIcon className="size-3" /> {m.admin_plugins_shared_creds_row_ready()}
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
    mutationFn: () => {
      if (!entry) return Promise.resolve();
      return fetchDeleteSharedCredential({ pluginId, credId: entry.id });
    },
    onSuccess: () => {
      toast.success(m.admin_plugins_shared_creds_toast_deleted());
      onDeleted();
      onClose();
    },
    onError: () => {
      toast.error(m.admin_plugins_shared_creds_toast_delete_error());
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
            {entry?.label
              ? m.admin_plugins_shared_creds_delete_title({ label: entry.label })
              : null}
          </DialogTitle>
          <DialogDescription>{m.admin_plugins_shared_creds_delete_description()}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {m.admin_plugins_shared_creds_delete_cancel()}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
            {m.admin_plugins_shared_creds_delete_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
