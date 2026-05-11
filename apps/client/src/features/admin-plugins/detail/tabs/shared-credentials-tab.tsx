import { useQueryClient } from "@tanstack/react-query";
import type { JSONSchema } from "@ent-mcp/shared";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty";
import { SharedCredentialsSection } from "@/features/admin";

import { adminPluginsKeys } from "../../shared/query-keys";
import type { PluginRow } from "../../shared/types";

interface SharedCredentialsTabProps {
  plugin: PluginRow;
}

function capabilityHint(
  plugin: PluginRow,
): "global-only" | "user-fallback" | "global-and-fallback" {
  const hasUser = plugin.capabilities.some((c) => c.scope === "user");
  const hasGlobal = plugin.capabilities.some((c) => c.scope === "global");
  if (hasGlobal && hasUser) return "global-and-fallback";
  if (hasGlobal) return "global-only";
  return "user-fallback";
}

export function SharedCredentialsTab({ plugin }: SharedCredentialsTabProps) {
  const qc = useQueryClient();
  const schema = (plugin.manifest.sharedCredentialsSchema ?? null) as JSONSchema | null;

  if (!schema) {
    return (
      <Card>
        <Empty className="border-0">
          <EmptyHeader>
            <EmptyTitle>No shared credentials for this plugin</EmptyTitle>
            <EmptyDescription>
              {plugin.manifest.name} only exposes user-scoped capabilities. Each user must connect
              their own account from Settings → Connections.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shared credentials pool</CardTitle>
        <CardDescription>
          {plugin.poolable
            ? `${plugin.sharedCredentialsEnabledCount} of ${plugin.sharedCredentialsCount} active. The server rotates between enabled keys when one hits a rate limit.`
            : `${plugin.manifest.name} accepts a single shared key. Replace the existing entry rather than adding another.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SharedCredentialsSection
          pluginId={plugin.id}
          pluginName={plugin.manifest.name}
          schema={schema}
          poolable={plugin.poolable}
          capabilityHint={capabilityHint(plugin)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: adminPluginsKeys.list() });
          }}
        />
      </CardContent>
    </Card>
  );
}
