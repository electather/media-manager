// fallow-ignore-file complexity
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { head } from "es-toolkit/array";
import { trim } from "es-toolkit/string";
import {
  BellIcon,
  EditIcon,
  LoaderCircleIcon,
  PlayIcon,
  PlusIcon,
  ShieldIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { NameGlyph } from "@/shared/components/name-glyph";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";
import type { NotificationCategory } from "@ent-mcp/shared/notifications";
import { ConnectionModal, type PluginSummary } from "@/features/connections";
import { useCategories } from "../hooks/use-categories";
import { useChannels } from "../hooks/use-channels";
import { useDeleteChannel } from "../hooks/use-delete-channel";
import { useNotificationPlugins } from "../hooks/use-notification-plugins";
import { useRenameChannel } from "../hooks/use-rename-channel";
import { useSubscriptions } from "../hooks/use-subscriptions";
import { useTestChannel } from "../hooks/use-test-channel";
import { useToggleSubscription } from "../hooks/use-toggle-subscription";
import type { ChannelRowData, NotificationPluginEntry, NotifCategory } from "../lib/types";

function isInboxRow(channel: { pluginId: string }): boolean {
  return channel.pluginId === "inbox";
}

export function SettingsNotificationsChannels({
  addOpen,
  setAddOpen,
}: {
  addOpen: boolean;
  setAddOpen: (open: boolean) => void;
}) {
  const channels = useChannels().data.channels as ChannelRowData[];
  const categoriesResp = useCategories().data.categories;
  const subsResp = useSubscriptions().data.subscriptions;
  const notificationPlugins = useNotificationPlugins().data;
  const qc = useQueryClient();

  const toggle = useToggleSubscription();
  const test = useTestChannel();
  const deleteChannel = useDeleteChannel();
  const renameChannel = useRenameChannel();

  const [modalPlugin, setModalPlugin] = useState<PluginSummary | null>(null);
  const [editTarget, setEditTarget] = useState<ChannelRowData | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelRowData | null>(null);

  const subsByChannel = useMemo(() => {
    const map = new Map<string, Set<NotificationCategory>>();
    for (const s of subsResp) {
      if (!s.enabled) continue;
      const set = map.get(s.connectionId) ?? new Set<NotificationCategory>();
      set.add(s.category);
      map.set(s.connectionId, set);
    }
    return map;
  }, [subsResp]);

  const handleReplaceSubs = (channelId: string, next: NotificationCategory[]) => {
    const current = subsByChannel.get(channelId) ?? new Set<NotificationCategory>();
    const nextSet = new Set(next);
    for (const cat of categoriesResp) {
      const wasOn = current.has(cat.id);
      const willBeOn = nextSet.has(cat.id);
      if (wasOn === willBeOn) continue;
      toggle.mutate({ connectionId: channelId, category: cat.id, enabled: willBeOn });
    }
  };

  const handleTest = (ch: ChannelRowData) => test.mutate(ch.id);

  const handleEditSave = (id: string, displayName: string) => {
    if (!editTarget) return;
    renameChannel.mutate(
      { id, displayName },
      {
        onSuccess: () => {
          toast.success(m.settings_notifications_toast_updated());
          setEditTarget(null);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleAddPickerSelect = (entry: NotificationPluginEntry) => {
    setAddOpen(false);
    // The notifications endpoint returns the same `PluginSummary` shape that
    // `/connections/available` does, with an extra `supportsKinds` field.
    // `ConnectionModal` only reads the summary fields, so we hand `entry`
    // straight through — extra keys are ignored at the structural type
    // boundary.
    setModalPlugin(entry);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    deleteChannel.mutate(target.id, {
      onSuccess: () =>
        toast.success(
          m.settings_notifications_toast_removed({
            name: target.displayName ?? target.plugin.name,
          }),
        ),
      onError: (err) => toast.error(err.message),
    });
    setDeleteTarget(null);
  };

  const firstChannel = head(channels);
  const onlyInbox = channels.length === 1 && firstChannel ? isInboxRow(firstChannel) : false;

  return (
    <>
      <NotificationsChannelsCard
        channels={channels}
        categories={categoriesResp}
        subsByChannel={subsByChannel}
        testingId={test.isPending ? ((test.variables as string | undefined) ?? null) : null}
        onlyInbox={onlyInbox}
        onAddOpen={() => setAddOpen(true)}
        onReplaceSubs={handleReplaceSubs}
        onTest={handleTest}
        onEdit={setEditTarget}
        onDelete={setDeleteTarget}
      />
      <AddChannelDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        plugins={notificationPlugins}
        existingPluginIds={channels.map((c) => c.pluginId)}
        onPick={handleAddPickerSelect}
      />
      <ConnectionModal
        open={!!modalPlugin}
        plugin={modalPlugin}
        existing={null}
        onOpenChange={(open) => {
          if (!open) setModalPlugin(null);
        }}
        onSuccess={() => {
          void qc.invalidateQueries({ queryKey: notificationsKeys.channels() });
        }}
      />
      <EditChannelDialog
        channel={editTarget}
        submitting={renameChannel.isPending}
        onClose={() => setEditTarget(null)}
        onSave={handleEditSave}
      />
      <DeleteChannelDialog
        channel={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
}

function NotificationsChannelsCard({
  channels,
  categories,
  subsByChannel,
  testingId,
  onlyInbox,
  onAddOpen,
  onReplaceSubs,
  onTest,
  onEdit,
  onDelete,
}: {
  channels: ReadonlyArray<ChannelRowData>;
  categories: ReadonlyArray<NotifCategory>;
  subsByChannel: Map<string, Set<NotificationCategory>>;
  testingId: string | null;
  onlyInbox: boolean;
  onAddOpen: () => void;
  onReplaceSubs: (channelId: string, next: NotificationCategory[]) => void;
  onTest: (ch: ChannelRowData) => void;
  onEdit: (ch: ChannelRowData) => void;
  onDelete: (ch: ChannelRowData) => void;
}) {
  return (
    <>
      <CategoryLegend categories={categories} />
      <ul role="list" className="flex flex-col">
        {channels.map((channel, i) => {
          const inbox = isInboxRow(channel);
          const active = inbox
            ? new Set<NotificationCategory>(categories.map((c) => c.id))
            : (subsByChannel.get(channel.id) ?? new Set<NotificationCategory>());
          return (
            <ChannelRow
              key={channel.id}
              channel={channel}
              isFirst={i === 0}
              inboxStyle={inbox}
              categories={categories}
              activeCategories={[...active]}
              testing={testingId === channel.id}
              onReplaceSubs={(next) => onReplaceSubs(channel.id, next)}
              onTest={() => onTest(channel)}
              onEdit={() => onEdit(channel)}
              onDelete={() => onDelete(channel)}
            />
          );
        })}
      </ul>
      {onlyInbox ? <OnlyInboxFooter onAdd={onAddOpen} /> : null}
    </>
  );
}

function CategoryLegend({ categories }: { categories: ReadonlyArray<NotifCategory> }) {
  return (
    <div className="border-b border-border bg-muted/40 px-5 py-3 sm:px-6">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">
        {m.settings_notifications_channels_categories_label()}
      </div>
      <div className="flex flex-col gap-1.5 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
        <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
          {m.settings_notifications_channels_categories_label()}
        </span>
        {categories.map((cat) => {
          const restricted = !cat.allowed;
          return (
            <span
              key={cat.id}
              className={cn(
                "flex items-center gap-1.5",
                restricted ? "text-muted-foreground/70" : "text-muted-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  restricted ? "bg-muted-foreground/40" : "bg-primary",
                )}
              />
              <span className="font-medium text-foreground">{cat.label}</span>
              <span className="hidden text-muted-foreground sm:inline">{cat.description}</span>
              {restricted ? (
                <Badge
                  variant="outline"
                  className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide sm:ml-0"
                >
                  {m.settings_notifications_admin_only({ role: "admin" })}
                </Badge>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ChannelRow({
  channel,
  isFirst,
  inboxStyle,
  categories,
  activeCategories,
  testing,
  onReplaceSubs,
  onTest,
  onEdit,
  onDelete,
}: {
  channel: ChannelRowData;
  isFirst: boolean;
  inboxStyle: boolean;
  categories: ReadonlyArray<NotifCategory>;
  activeCategories: NotificationCategory[];
  testing: boolean;
  onReplaceSubs: (next: NotificationCategory[]) => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className={cn(
        "grid gap-3 px-5 py-4 sm:px-6",
        "grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        !isFirst && "border-t border-border",
      )}
    >
      <NameGlyph name={channel.displayName ?? channel.plugin.name} />
      <ChannelRowHeader channel={channel} inboxStyle={inboxStyle} />
      <ChannelRowActions
        inboxStyle={inboxStyle}
        testing={testing}
        onTest={onTest}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      <ChannelRowDelivers
        inboxStyle={inboxStyle}
        categories={categories}
        activeCategories={activeCategories}
        onReplaceSubs={onReplaceSubs}
      />
    </li>
  );
}

function ChannelRowHeader({
  channel,
  inboxStyle,
}: {
  channel: ChannelRowData;
  inboxStyle: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {channel.displayName ?? channel.plugin.name}
        </span>
        <Badge variant="outline" className="font-mono text-[10px]">
          {channel.plugin.name}@{channel.plugin.version}
        </Badge>
        {inboxStyle ? (
          <Badge
            variant="secondary"
            className="border-success/30 bg-success/10 font-mono text-[10px] uppercase tracking-wide text-success"
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
            {m.settings_notifications_channels_always_on()}
          </Badge>
        ) : null}
      </div>
      <div className="mt-1 flex flex-col gap-y-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-3.5">
        {channel.displayFields.map((c) => (
          <span key={c.label} className="flex min-w-0 items-baseline gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
              {c.label}
            </span>
            <span
              className={cn(
                "min-w-0 truncate text-foreground/80",
                c.mono ? "font-mono" : undefined,
              )}
            >
              {c.value}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ChannelRowActions({
  inboxStyle,
  testing,
  onTest,
  onEdit,
  onDelete,
}: {
  inboxStyle: boolean;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="col-span-2 flex flex-wrap items-center justify-end gap-1.5 sm:col-span-1 sm:self-start">
      {inboxStyle ? (
        <span className="inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
          <ShieldIcon className="size-3.5" aria-hidden="true" />
          {m.settings_notifications_channels_locked()}
        </span>
      ) : (
        <>
          <Button variant="outline" size="xs" onClick={onTest} disabled={testing}>
            {testing ? (
              <>
                <LoaderCircleIcon className="size-3.5 animate-spin" />
                {m.settings_notifications_channels_testing()}
              </>
            ) : (
              <>
                <PlayIcon className="size-3.5" />
                {m.settings_notifications_channels_test()}
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onEdit}
            aria-label={m.settings_notifications_channels_edit()}
          >
            <EditIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            aria-label={m.settings_notifications_channels_delete()}
            className="text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
          >
            <XIcon className="size-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

function ChannelRowDelivers({
  inboxStyle,
  categories,
  activeCategories,
  onReplaceSubs,
}: {
  inboxStyle: boolean;
  categories: ReadonlyArray<NotifCategory>;
  activeCategories: NotificationCategory[];
  onReplaceSubs: (next: NotificationCategory[]) => void;
}) {
  return (
    <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:pl-12">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {m.settings_notifications_channels_delivers()}
      </span>
      <ToggleGroup<NotificationCategory>
        multiple
        aria-label={m.settings_notifications_channels_delivers()}
        disabled={inboxStyle}
        value={activeCategories}
        onValueChange={(next) => onReplaceSubs(next)}
        className="flex flex-wrap gap-1.5"
      >
        {categories.map((cat) => {
          const restricted = !cat.allowed;
          const tooltip = inboxStyle
            ? m.settings_notifications_channels_inbox_locked()
            : restricted
              ? m.settings_notifications_channels_locked_admin()
              : undefined;
          return (
            <ToggleGroupItem
              key={cat.id}
              value={cat.id}
              disabled={inboxStyle || restricted}
              title={tooltip}
              className={cn(
                inboxStyle &&
                  "data-pressed:border-success/30 data-pressed:bg-success/10 data-pressed:text-success",
              )}
            >
              {cat.label}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}

function OnlyInboxFooter({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 border-t border-border px-6 py-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
        <BellIcon className="size-4" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">
          {m.settings_notifications_channels_only_inbox_title()}
        </p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">
          {m.settings_notifications_channels_only_inbox_description()}
        </p>
      </div>
      <Button size="sm" onClick={onAdd}>
        <PlusIcon className="size-3.5" />
        {m.settings_notifications_channels_add()}
      </Button>
    </div>
  );
}

function AddChannelDialog({
  open,
  onClose,
  plugins,
  existingPluginIds,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  plugins: ReadonlyArray<NotificationPluginEntry>;
  existingPluginIds: ReadonlyArray<string>;
  onPick: (plugin: NotificationPluginEntry) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.settings_notifications_dialog_add_title()}</DialogTitle>
          <DialogDescription>{m.settings_notifications_dialog_add_description()}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {plugins.map((p) => {
            const already = existingPluginIds.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                disabled={already}
                onClick={() => !already && onPick(p)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left text-sm transition-colors",
                  already ? "opacity-60" : "hover:border-input hover:bg-muted/40",
                )}
              >
                <NameGlyph name={p.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-foreground">{p.name}</span>
                    {already ? (
                      <span className="text-xs text-muted-foreground">
                        · {m.settings_notifications_dialog_add_already()}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
                </div>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.settings_notifications_dialog_cancel()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteChannelDialog({
  channel,
  onClose,
  onConfirm,
}: {
  channel: ChannelRowData | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={!!channel}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.settings_notifications_dialog_delete_title()}</DialogTitle>
          <DialogDescription>
            {channel
              ? m.settings_notifications_dialog_delete_body({
                  name: channel.displayName ?? channel.plugin.name,
                  plugin: `${channel.plugin.name}@${channel.plugin.version}`,
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.settings_notifications_dialog_cancel()}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {m.settings_notifications_dialog_delete_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditChannelDialog({
  channel,
  submitting,
  onClose,
  onSave,
}: {
  channel: ChannelRowData | null;
  submitting: boolean;
  onClose: () => void;
  onSave: (id: string, displayName: string) => void;
}) {
  const [name, setName] = useState("");

  // Reset local form state whenever the dialog target changes — without this,
  // typing in one channel's edit dialog would leak into the next channel
  // opened in the same session.
  useEffect(() => {
    setName(channel?.displayName ?? "");
  }, [channel?.id, channel?.displayName]);

  if (!channel) return null;

  const initial = channel.displayName ?? "";
  const trimmedName = trim(name);
  const dirty = trimmedName !== trim(initial);

  return (
    <Dialog open={!!channel} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {m.settings_notifications_dialog_edit_title({ name: channel.plugin.name })}
          </DialogTitle>
          <DialogDescription>
            {m.settings_notifications_dialog_edit_description()}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={channel.plugin.name}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            data-testid="edit-channel-name"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {m.settings_notifications_dialog_cancel()}
          </Button>
          <Button disabled={!dirty || submitting} onClick={() => onSave(channel.id, trimmedName)}>
            {submitting ? <LoaderCircleIcon className="size-4 animate-spin" /> : null}
            {m.settings_notifications_dialog_save()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
