import { useQueryClient } from "@tanstack/react-query";
import type { JSONSchema } from "@ent-mcp/shared";

import { m } from "@/paraglide/messages";

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
            <EmptyTitle>{m.admin_plugins_shared_creds_no_creds_title()}</EmptyTitle>
            <EmptyDescription>
              {m.admin_plugins_shared_creds_no_creds_description({ name: plugin.manifest.name })}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.admin_plugins_shared_creds_title()}</CardTitle>
        <CardDescription>
          {plugin.poolable
            ? m.admin_plugins_shared_creds_pool_description({
                enabled: plugin.sharedCredentialsEnabledCount,
                total: plugin.sharedCredentialsCount,
              })
            : m.admin_plugins_shared_creds_single_description({ name: plugin.manifest.name })}
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
