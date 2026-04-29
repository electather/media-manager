import { head } from "es-toolkit/array";
import { getCapability } from "@ent-mcp/plugin-sdk";
import type { CapabilityDefinition, ResolvedCapabilityScope } from "@ent-mcp/plugin-sdk";
import { resolveConnections, type ResolvedConnection } from "./resolve-connection";
import { PluginCallError } from "./errors";

export function requireCapability(id: string, version: string): CapabilityDefinition {
  const cap = getCapability(id, version);
  if (!cap) {
    throw new PluginCallError(
      "plugin.missing_method",
      `unknown capability ${id}@${version}`,
      "",
      null,
    );
  }
  return cap;
}

/**
 * Resolves which scope a single dispatch request should execute under. This
 * value drives two parallel lookups that MUST agree for correctness:
 *   1. Provider enumeration (`capabilityRegistry.listProviders(…, scope)`).
 *   2. Cache keying (`cacheKey({ …, scope })`) — a user-scoped result must
 *      live in a userId-qualified key so it can't be served to other users.
 *
 * For `scope: "global"` / `"user"` capabilities this is a constant; for
 * `"mixed"` capabilities (today: `idResolve@v1`) the capability's
 * `scopeForInput` classifies the request — typically by looking at the
 * input's id kind. Each dispatch strategy computes this once at entry and
 * threads the result through every subsequent step so a future impure
 * classifier cannot observe or diverge across the lookups.
 *
 * The discriminated union on `CapabilityDefinition` guarantees at the type
 * level that `scopeForInput` is present whenever `scope === "mixed"`, so
 * no runtime guard is needed here — a malformed capability defined via an
 * `as any` cast would fail on the subsequent call with a descriptive
 * TypeError.
 */
export function scopeForRequest(
  capability: CapabilityDefinition,
  input: unknown,
): ResolvedCapabilityScope {
  if (capability.scope === "mixed") return capability.scopeForInput(input);
  return capability.scope;
}

export async function pickSingleConnection(
  userId: string,
  pluginId: string,
): Promise<ResolvedConnection | null> {
  const all = await resolveConnections(userId, pluginId);
  return head(all) ?? null;
}
