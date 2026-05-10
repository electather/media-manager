// fallow-ignore-file complexity
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
import { Field, FieldTitle } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/app/settings-layout";
import { SettingsCard, SettingsCardHeader } from "@/features/settings";
import { NameGlyph } from "@/shared/components/name-glyph";
import {
  DEFAULT_SUBSCRIPTIONS,
  MOCK_AVAILABLE_CHANNEL_PLUGINS,
  MOCK_CATEGORIES,
  MOCK_CHANNELS,
  type CategoryId,
  type ChannelSubscriptions,
  type MockChannel,
} from "@/features/settings/mocks";

export const Route = createFileRoute("/_authenticated/_settings/settings/notifications")({
  component: NotificationsRoute,
});

function NotificationsRoute() {
  return (
    <SettingsErrorBoundary>
      <NotificationsPage />
    </SettingsErrorBoundary>
  );
}

const ROLE_RANK: Record<string, number> = { member: 0, admin: 1 };

function useNotificationsState() {
  const [channels, setChannels] = useState<ReadonlyArray<MockChannel>>(MOCK_CHANNELS);
  const [subs, setSubs] = useState<ChannelSubscriptions>(DEFAULT_SUBSCRIPTIONS);
  const [editChannel, setEditChannel] = useState<MockChannel | null>(null);
  const [deleteChannel, setDeleteChannel] = useState<MockChannel | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleReplaceSubs = (channelId: string, next: Record<CategoryId, boolean>) => {
    setSubs((prev) => ({ ...prev, [channelId]: next }));
  };

  const handleTest = (ch: MockChannel) => {
    setTestingId(ch.id);
    window.setTimeout(() => {
      setTestingId(null);
      toast.success(m.settings_notifications_toast_test_sent({ name: ch.name }));
    }, 700);
  };

  const handleDelete = () => {
    if (!deleteChannel) return;
    const removed = deleteChannel;
    setChannels((list) => list.filter((c) => c.id !== removed.id));
    setSubs((prev) => {
      const next = { ...prev };
      delete next[removed.id];
      return next;
    });
    toast.success(m.settings_notifications_toast_removed({ name: removed.name }));
    setDeleteChannel(null);
  };

  const handleEditSave = (next: MockChannel) => {
    setChannels((list) => list.map((c) => (c.id === next.id ? next : c)));
    setEditChannel(null);
    toast.success(m.settings_notifications_toast_updated());
  };

  const handleAddPlugin = (pluginId: string) => {
    const meta = MOCK_AVAILABLE_CHANNEL_PLUGINS.find((p) => p.pluginId === pluginId);
    if (!meta) return;
    const seedConfig: Record<string, ReadonlyArray<{ label: string; value: string }>> = {
      ntfy: [
        { label: "topic", value: "" },
        { label: "server", value: "https://ntfy.sh" },
      ],
      telegram: [
        { label: "chat_id", value: "" },
        { label: "bot", value: "" },
      ],
      discord: [{ label: "webhook", value: "" }],
      webhook: [
        { label: "url", value: "" },
        { label: "method", value: "POST" },
      ],
    };
    const newChannel: MockChannel = {
      id: `ch-${Date.now().toString(36)}`,
      pluginId,
      pluginName: meta.name,
      pluginVersion: meta.version,
      name: `New ${meta.name}`,
      config: seedConfig[pluginId] ?? [],
    };
    setChannels((list) => [...list, newChannel]);
    setSubs((prev) => ({
      ...prev,
      [newChannel.id]: { media: true, sync: true, auth: false, system: false },
    }));
    setAddOpen(false);
    setEditChannel(newChannel);
  };

  return {
    channels,
    subs,
    editChannel,
    deleteChannel,
    addOpen,
    testingId,
    handleReplaceSubs,
    handleTest,
    handleDelete,
    handleEditSave,
    handleAddPlugin,
    setAddOpen,
    setEditChannel,
    setDeleteChannel,
  };
}

function NotificationsPage() {
  const {
    channels,
    subs,
    editChannel,
    deleteChannel,
    addOpen,
    testingId,
    handleReplaceSubs,
    handleTest,
    handleEditSave,
    handleAddPlugin,
    setAddOpen,
    setEditChannel,
    setDeleteChannel,
    handleDelete,
  } = useNotificationsState();
  const role = "member";
  const onlyInbox = channels.length === 1 && channels[0]?.locked === true;

  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_notifications_title()}
        description={m.settings_notifications_description()}
      />
      <NotificationsChannelsCard
        channels={channels}
        subs={subs}
        role={role}
        testingId={testingId}
        onlyInbox={onlyInbox}
        onAddOpen={() => setAddOpen(true)}
        onReplaceSubs={handleReplaceSubs}
        onTest={handleTest}
        onEdit={setEditChannel}
        onDelete={setDeleteChannel}
      />
      <AddChannelDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existingPluginIds={channels.map((c) => c.pluginId)}
        onPick={(p) => handleAddPlugin(p.pluginId)}
      />
      <EditChannelDialog
        channel={editChannel}
        onClose={() => setEditChannel(null)}
        onSave={handleEditSave}
      />
      <DeleteChannelDialog
        channel={deleteChannel}
        onClose={() => setDeleteChannel(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function NotificationsChannelsCard({
  channels,
  subs,
  role,
  testingId,
  onlyInbox,
  onAddOpen,
  onReplaceSubs,
  onTest,
  onEdit,
  onDelete,
}: {
  channels: ReadonlyArray<MockChannel>;
  subs: ChannelSubscriptions;
  role: string;
  testingId: string | null;
  onlyInbox: boolean;
  onAddOpen: () => void;
  onReplaceSubs: (channelId: string, next: Record<CategoryId, boolean>) => void;
  onTest: (ch: MockChannel) => void;
  onEdit: (ch: MockChannel) => void;
  onDelete: (ch: MockChannel) => void;
}) {
  return (
    <SettingsCard>
      <SettingsCardHeader
        title={m.settings_notifications_channels_title()}
        description={m.settings_notifications_channels_description()}
        action={
          <Button variant="outline" size="sm" onClick={onAddOpen}>
            <PlusIcon className="size-3.5" />
            {m.settings_notifications_channels_add()}
          </Button>
        }
      />
      <CategoryLegend role={role} />
      <ul role="list" className="flex flex-col">
        {channels.map((channel, i) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            isFirst={i === 0}
            role={role}
            subs={subs[channel.id]}
            testing={testingId === channel.id}
            onReplaceSubs={(next) => onReplaceSubs(channel.id, next)}
            onTest={() => onTest(channel)}
            onEdit={() => onEdit(channel)}
            onDelete={() => onDelete(channel)}
          />
        ))}
      </ul>
      {onlyInbox ? <OnlyInboxFooter onAdd={onAddOpen} /> : null}
    </SettingsCard>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<CategoryId, () => string> = {
  media: () => m.settings_notifications_category_media(),
  sync: () => m.settings_notifications_category_sync(),
  auth: () => m.settings_notifications_category_auth(),
  system: () => m.settings_notifications_category_system(),
};

const CATEGORY_HINT: Record<CategoryId, () => string> = {
  media: () => m.settings_notifications_category_media_hint(),
  sync: () => m.settings_notifications_category_sync_hint(),
  auth: () => m.settings_notifications_category_auth_hint(),
  system: () => m.settings_notifications_category_system_hint(),
};

function CategoryLegend({ role }: { role: string }) {
  return (
    <div className="border-b border-border bg-muted/40 px-5 py-3 sm:px-6">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:hidden">
        {m.settings_notifications_channels_categories_label()}
      </div>
      <div className="flex flex-col gap-1.5 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
        <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:inline">
          {m.settings_notifications_channels_categories_label()}
        </span>
        {MOCK_CATEGORIES.map((cat) => {
          const restricted =
            cat.requires && (ROLE_RANK[role] ?? 0) < (ROLE_RANK[cat.requires] ?? 0);
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
              <span className="font-medium text-foreground">{CATEGORY_LABEL[cat.id]()}</span>
              <span className="hidden text-muted-foreground sm:inline">
                {CATEGORY_HINT[cat.id]()}
              </span>
              {restricted ? (
                <Badge
                  variant="outline"
                  className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide sm:ml-0"
                >
                  {m.settings_notifications_admin_only({ role: cat.requires })}
                </Badge>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface ChannelRowProps {
  channel: MockChannel;
  isFirst: boolean;
  role: string;
  subs: Record<CategoryId, boolean> | undefined;
  testing: boolean;
  onReplaceSubs: (next: Record<CategoryId, boolean>) => void;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ChannelRowHeader({ channel }: { channel: MockChannel }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{channel.name}</span>
        <Badge variant="outline" className="font-mono text-[10px]">
          {channel.pluginName}@{channel.pluginVersion}
        </Badge>
        {channel.locked ? (
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
        {channel.config.map((c) => (
          <span key={c.label} className="flex min-w-0 items-baseline gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
              {c.label}
            </span>
            <span className="min-w-0 truncate font-mono text-foreground/80">{c.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ChannelRowActions({
  channel,
  testing,
  onTest,
  onEdit,
  onDelete,
}: {
  channel: MockChannel;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="col-span-2 flex flex-wrap items-center justify-end gap-1.5 sm:col-span-1 sm:self-start">
      {channel.locked ? (
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
  activeCategories,
  role,
  onReplaceSubs,
}: {
  inboxStyle: boolean;
  activeCategories: CategoryId[];
  role: string;
  onReplaceSubs: (next: Record<CategoryId, boolean>) => void;
}) {
  return (
    <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 sm:pl-12">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {m.settings_notifications_channels_delivers()}
      </span>
      <ToggleGroup<CategoryId>
        multiple
        aria-label={m.settings_notifications_channels_delivers()}
        disabled={inboxStyle}
        value={activeCategories}
        onValueChange={(next) =>
          onReplaceSubs({
            media: next.includes("media"),
            sync: next.includes("sync"),
            auth: next.includes("auth"),
            system: next.includes("system"),
          })
        }
        className="flex flex-wrap gap-1.5"
      >
        {MOCK_CATEGORIES.map((cat) => {
          const restricted =
            cat.requires && (ROLE_RANK[role] ?? 0) < (ROLE_RANK[cat.requires] ?? 0);
          const tooltip = inboxStyle
            ? m.settings_notifications_channels_inbox_locked()
            : restricted
              ? m.settings_notifications_channels_locked_admin()
              : undefined;
          return (
            <ToggleGroupItem
              key={cat.id}
              value={cat.id}
              disabled={inboxStyle || !!restricted}
              title={tooltip}
              className={cn(
                inboxStyle &&
                  "data-pressed:border-success/30 data-pressed:bg-success/10 data-pressed:text-success",
              )}
            >
              {CATEGORY_LABEL[cat.id]()}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}

function ChannelRow({
  channel,
  isFirst,
  role,
  subs,
  testing,
  onReplaceSubs,
  onTest,
  onEdit,
  onDelete,
}: ChannelRowProps) {
  const inboxStyle = !!channel.locked;
  const activeCategories: CategoryId[] = MOCK_CATEGORIES.flatMap((cat) => {
    if (inboxStyle) return [cat.id];
    return subs?.[cat.id] ? [cat.id] : [];
  });

  return (
    <li
      className={cn(
        "grid gap-3 px-5 py-4 sm:px-6",
        "grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        !isFirst && "border-t border-border",
      )}
    >
      <NameGlyph name={channel.name} />
      <ChannelRowHeader channel={channel} />
      <ChannelRowActions
        channel={channel}
        testing={testing}
        onTest={onTest}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      <ChannelRowDelivers
        inboxStyle={inboxStyle}
        activeCategories={activeCategories}
        role={role}
        onReplaceSubs={onReplaceSubs}
      />
    </li>
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

// ─── Add channel dialog ─────────────────────────────────────────────────────

function AddChannelDialog({
  open,
  onClose,
  existingPluginIds,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  existingPluginIds: ReadonlyArray<string>;
  onPick: (plugin: { pluginId: string; name: string; version: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.settings_notifications_dialog_add_title()}</DialogTitle>
          <DialogDescription>{m.settings_notifications_dialog_add_description()}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {MOCK_AVAILABLE_CHANNEL_PLUGINS.map((p) => {
            const already = existingPluginIds.includes(p.pluginId);
            return (
              <button
                key={p.pluginId}
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
                    <span className="font-mono text-[10px] text-muted-foreground/80">
                      v{p.version}
                    </span>
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

// ─── Delete channel dialog ───────────────────────────────────────────────────

function DeleteChannelDialog({
  channel,
  onClose,
  onConfirm,
}: {
  channel: MockChannel | null;
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
                  name: channel.name,
                  plugin: `${channel.pluginName}@${channel.pluginVersion}`,
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

// ─── Edit channel dialog ────────────────────────────────────────────────────

function ConfigFieldList({
  config,
  onUpdate,
}: {
  config: ReadonlyArray<{ label: string; value: string }>;
  onUpdate: (idx: number, value: string) => void;
}) {
  return (
    <>
      {config.map((c, i) => (
        <Field key={c.label}>
          <FieldTitle className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
            {c.label}
          </FieldTitle>
          <Input
            value={c.value}
            onChange={(e) => onUpdate(i, e.target.value)}
            className="font-mono text-xs"
          />
        </Field>
      ))}
    </>
  );
}

function EditChannelDialog({
  channel,
  onClose,
  onSave,
}: {
  channel: MockChannel | null;
  onClose: () => void;
  onSave: (next: MockChannel) => void;
}) {
  const [name, setName] = useState(channel?.name ?? "");
  const [config, setConfig] = useState<ReadonlyArray<{ label: string; value: string }>>(
    channel?.config ?? [],
  );

  // Sync local form state when the dialog target changes.
  useEffect(() => {
    if (channel) {
      setName(channel.name);
      setConfig(channel.config.map((c) => ({ ...c })));
    }
  }, [channel]);

  if (!channel) return null;

  const dirty =
    name !== channel.name ||
    config.some((c, i) => channel.config[i] && c.value !== channel.config[i].value);

  const updateConfig = (idx: number, value: string) => {
    setConfig((prev) => prev.map((c, i) => (i === idx ? { ...c, value } : c)));
  };

  return (
    <Dialog open={!!channel} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {m.settings_notifications_dialog_edit_title({ name: channel.pluginName })}
          </DialogTitle>
          <DialogDescription>
            {m.settings_notifications_dialog_edit_description()}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field>
            <FieldTitle>{m.settings_notifications_dialog_edit_name()}</FieldTitle>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ConfigFieldList config={config} onUpdate={updateConfig} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.settings_notifications_dialog_cancel()}
          </Button>
          <Button disabled={!dirty} onClick={() => onSave({ ...channel, name, config })}>
            {m.settings_notifications_dialog_save()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
