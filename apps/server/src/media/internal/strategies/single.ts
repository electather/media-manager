import { pickSingleConnection } from "../capability-lookup";
import { writeCache, applyInvalidations } from "../dispatch-cache";
import { invokeOne, harvestFromOutcomes } from "../../service/invoke";
import { PluginCallError } from "../../errors";
import type { DispatchRequest } from "../../types";
import { resolveDispatchPreamble } from "./shared";

/**
 * `single` strategy: one connection, no fan-out. Returns the plugin's data or
 * `null` (for `not_found`); throws `PluginCallError` on any other failure.
 */
// fallow-ignore-next-line complexity
export async function dispatchSingle<T>(req: DispatchRequest): Promise<T | null> {
  const { capability, scope, cached, providers } = await resolveDispatchPreamble<T | null>(req);
  if (cached !== undefined) return cached;
  if (providers.length === 0) {
    throw new PluginCallError(
      "plugin.call_failed",
      `no provider installed for ${req.capability}@${req.version}`,
      "",
      null,
    );
  }
  const pluginId = req.pluginId && providers.includes(req.pluginId) ? req.pluginId : providers[0]!;
  const conn = await pickSingleConnection(req.userId, pluginId);
  if (!conn) {
    throw new PluginCallError(
      "media.no_connection",
      `no connection available for plugin ${pluginId}`,
      pluginId,
      null,
    );
  }

  const outcome = await invokeOne<T>(
    {
      userId: req.userId,
      pluginId,
      capability: req.capability,
      version: req.version,
      method: req.method,
      input: req.input,
      timeoutMs: capability.defaultTimeoutMs,
      deadlineMs: req.deadlineMs,
    },
    conn,
  );
  if (outcome.error) {
    if (outcome.error.code === "plugin.item_not_found") {
      await writeCache<T | null>(req, capability, scope, null);
      return null;
    }
    throw new PluginCallError(
      outcome.error.code,
      outcome.error.devMessage,
      outcome.pluginId,
      outcome.connectionId,
    );
  }
  await harvestFromOutcomes([outcome], req.mediaType);
  const value = (outcome.data ?? null) as T | null;
  await writeCache(req, capability, scope, value);
  await applyInvalidations(req, capability);
  return value;
}
