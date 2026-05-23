import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ConnectionListItem, PrimaryConnectionRow } from "@ent-mcp/shared/connections";
import type { MediaType } from "@ent-mcp/shared/media";

import { SettingsCard, SettingsCardHeader, SettingsCardRow } from "@/features/settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { m } from "@/paraglide/messages";

import { useConnections } from "../hooks/use-connections";
import { usePrimaryConnections } from "../hooks/use-primary-connections";
import { useSetPrimaryConnection } from "../hooks/use-set-primary-connection";
import { useClearPrimaryConnection } from "../hooks/use-clear-primary-connection";
import { PRIMARY_PROVIDER_ROWS } from "../lib/primary-rows";
import { settingsConnectionsKeys } from "../lib/query-keys";
import { SettingsConnectionsApiError } from "../lib/types";

const AUTO_VALUE = "__auto__";

interface RowDef {
  capabilityKey: string;
  mediaType: MediaType;
  labelMessage: () => string;
}

interface RenderableRow {
  row: RowDef;
  eligible: ConnectionListItem[];
  pinned: PrimaryConnectionRow | null;
}

function connectionAdvertises(connection: ConnectionListItem, capabilityKey: string): boolean {
  return connection.plugin.userScopedCapabilities.some(
    (cap) => `${cap.id}@${cap.version}` === capabilityKey,
  );
}

function buildRenderableRows(
  rows: ReadonlyArray<RowDef>,
  connections: ReadonlyArray<ConnectionListItem>,
  primaries: ReadonlyArray<PrimaryConnectionRow>,
): RenderableRow[] {
  return rows
    .map((row) => {
      const eligible = connections.filter(
        (c) => c.enabled && c.status === "connected" && connectionAdvertises(c, row.capabilityKey),
      );
      const pinned =
        primaries.find(
          (p) => p.capabilityKey === row.capabilityKey && p.mediaType === row.mediaType,
        ) ?? null;
      return { row, eligible, pinned };
    })
    .filter((r) => r.eligible.length >= 2);
}

export function PrimaryProvidersCard() {
  const connections = useConnections().data;
  const primaries = usePrimaryConnections().data;

  const renderable = useMemo(
    () => buildRenderableRows(PRIMARY_PROVIDER_ROWS, connections, primaries),
    [connections, primaries],
  );

  if (renderable.length === 0) return null;

  return (
    <SettingsCard data-testid="primary-providers-card">
      <SettingsCardHeader
        title={m.settings_connections_primary_section_title()}
        description={m.settings_connections_primary_section_description()}
      />
      {renderable.map((entry, idx) => (
        <PrimaryProviderRow
          key={`${entry.row.capabilityKey}:${entry.row.mediaType}`}
          row={entry.row}
          eligible={entry.eligible}
          pinned={entry.pinned}
          connections={connections}
          borderTop={idx > 0}
        />
      ))}
    </SettingsCard>
  );
}

interface PrimaryProviderRowProps {
  row: RowDef;
  eligible: ConnectionListItem[];
  pinned: PrimaryConnectionRow | null;
  connections: ReadonlyArray<ConnectionListItem>;
  borderTop: boolean;
}

// fallow-ignore-next-line complexity
function PrimaryProviderRow({
  row,
  eligible,
  pinned,
  connections,
  borderTop,
}: PrimaryProviderRowProps) {
  const setPrimary = useSetPrimaryConnection();
  const clearPrimary = useClearPrimaryConnection();
  const queryClient = useQueryClient();

  // If the user pinned a connection that is now disabled / disconnected /
  // deleted, the dropdown shows "Auto (was X)" so the state is legible. The
  // server's `getPrimaryConnection` already falls back to provider order in
  // that case — selecting any real connection cleans up by overwriting.
  const pinnedEligible = pinned
    ? (eligible.find((c) => c.id === pinned.connectionId) ?? null)
    : null;
  const stalePinned =
    pinned && !pinnedEligible
      ? (connections.find((c) => c.id === pinned.connectionId) ?? null)
      : null;

  const selectValue = pinnedEligible ? pinnedEligible.id : AUTO_VALUE;

  // Per spec §6: differentiate `connection.not_found` and
  // `connection.capability_unsupported` from generic 5xx, and refetch the
  // server state for the typed errors so the stale row gets evicted.
  const handleMutationError = (err: unknown) => {
    if (err instanceof SettingsConnectionsApiError) {
      if (err.code === "connection.not_found") {
        toast.error(m.settings_connections_primary_toast_not_found());
        void queryClient.invalidateQueries({ queryKey: settingsConnectionsKeys.primary() });
        void queryClient.invalidateQueries({ queryKey: settingsConnectionsKeys.connections() });
        return;
      }
      if (err.code === "connection.capability_unsupported") {
        toast.error(m.settings_connections_primary_toast_unsupported());
        void queryClient.invalidateQueries({ queryKey: settingsConnectionsKeys.primary() });
        return;
      }
    }
    toast.error(m.settings_connections_primary_toast_error());
  };

  const onValueChange = (next: string | null) => {
    if (next === null || next === AUTO_VALUE) {
      clearPrimary.mutate(
        { capabilityKey: row.capabilityKey, mediaType: row.mediaType },
        {
          onSuccess: () => toast.success(m.settings_connections_primary_toast_updated()),
          onError: handleMutationError,
        },
      );
      return;
    }
    setPrimary.mutate(
      { capabilityKey: row.capabilityKey, mediaType: row.mediaType, connectionId: next },
      {
        onSuccess: () => toast.success(m.settings_connections_primary_toast_updated()),
        onError: handleMutationError,
      },
    );
  };

  // Render the user-facing label for the currently selected value — the raw
  // `connection.id` is meaningless to the user, so render the connection's
  // displayName / plugin name instead. Falls back to "Auto" when the value
  // is the sentinel.
  // fallow-ignore-next-line complexity
  const renderTriggerLabel = (value: string | null): string => {
    if (value === null || value === AUTO_VALUE) {
      return stalePinned
        ? m.settings_connections_primary_auto_was_option({ name: connectionLabel(stalePinned) })
        : m.settings_connections_primary_auto_option();
    }
    const conn = eligible.find((c) => c.id === value);
    return conn ? connectionLabel(conn) : m.settings_connections_primary_auto_option();
  };

  return (
    <SettingsCardRow label={row.labelMessage()} borderTop={borderTop}>
      <Select value={selectValue} onValueChange={onValueChange}>
        <SelectTrigger size="sm" aria-label={row.labelMessage()} className="w-full sm:w-72">
          <SelectValue>{(value: string) => renderTriggerLabel(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_VALUE}>
            {stalePinned
              ? m.settings_connections_primary_auto_was_option({
                  name: connectionLabel(stalePinned),
                })
              : m.settings_connections_primary_auto_option()}
          </SelectItem>
          {eligible.map((conn) => (
            <SelectItem key={conn.id} value={conn.id}>
              {connectionLabel(conn)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsCardRow>
  );
}

function connectionLabel(connection: ConnectionListItem): string {
  return connection.displayName ?? connection.plugin.name;
}
