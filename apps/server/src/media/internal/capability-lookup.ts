import { head } from "es-toolkit/array";
import { getCapability } from "@nama/plugin-sdk";
import type { CapabilityDefinition, ResolvedCapabilityScope } from "@nama/plugin-sdk";
import { resolveConnections, type ResolvedConnection } from "./resolve-connection";
import { PluginCallError } from "../errors";

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
 * Resolves dispatch scope; drives provider enumeration and cache keying (MUST agree).
 * For constant scopes ("global"/"user"), is trivial; for "mixed" capabilities (idResolve@v1),
 * uses `scopeForInput` to classify request (computed once, threaded through all steps to prevent impure divergence).
 * CapabilityDefinition union guarantees scopeForInput when scope==="mixed", so no runtime guard needed.
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
  scope: ResolvedCapabilityScope,
): Promise<ResolvedConnection | null> {
  const all = await resolveConnections(userId, pluginId, scope);
  return head(all) ?? null;
}
