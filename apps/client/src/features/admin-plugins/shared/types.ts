import type { InferResponseType } from "hono/client";
import type { PersonalKeyFallbackPolicy } from "@ent-mcp/shared/plugins";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";
import { api } from "@/shared/lib/api";

export type PluginRow = InferResponseType<typeof api.plugins.$get>["plugins"][number];

export type PluginPurity = "user" | "global" | "mixed";

export function pluginPurity(plugin: PluginRow): PluginPurity {
  const hasUser = plugin.capabilities.some((c) => c.scope === "user");
  const hasGlobal = plugin.capabilities.some((c) => c.scope === "global");
  if (hasUser && hasGlobal) return "mixed";
  if (hasUser) return "user";
  return "global";
}

export type PluginListFilter = "all" | "enabled" | "disabled" | "user" | "metadata";

export function fallbackPolicyValue(plugin: PluginRow): PersonalKeyFallbackPolicy {
  return plugin.personalKeyFallback;
}

export class AdminPluginsApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("AdminPluginsApiError", status, body, `plugins request failed (${status})`);
  }
}
